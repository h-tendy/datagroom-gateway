// @ts-check
const router = require('express').Router();
const DbAbstraction = require('../dbAbstraction');
const ExcelUtils = require('../excelUtils');
const fs = require('fs');
const Jira = require('../jira/jira');
const JiraAgile = require('../jira/jiraAgile')
const JiraFieldEdit = require('../jira/jiraFieldEdit');
const JiraSettings = require('../jiraSettings');
const Utils = require('../utils');
const PrepAttachments = require('../prepAttachments');
const AclCheck = require('../acl');
const PerRowAcessCheck = require('../perRowAccessCheck');
const MongoFilters = require('./mongoFilters');
// @ts-ignore
const { ObjectId } = require('mongodb');
const logger = require('../logger');

let host = JiraSettings.host;

router.post('/archive', async (req, res, next) => {
    let request = req.body;
    logger.info({requestId: req.requestId, request}, "Incoming request to archive dataset");
    try {
        const token = req.cookies.jwt;
        let status = {};
        if (!request.sourceDataSetName || !request.archiveDataSetName || !request.cutOffDate) {
            status.error = new Error("One or more required parameters is missing");
        } else {
            let sourceDsAccessAllowed = await AclCheck.aclCheck(request.sourceDataSetName, "default", req.params.dsUser, token);
            if (!sourceDsAccessAllowed) {
                status.error = `${request.sourceDataSetName} dataset access denied`;
                res.status(403).json(status);
                return
            }
            let archiveDsAccessAllowed = await AclCheck.aclCheck(request.archiveDataSetName, "default", req.params.dsUser, token);
            if (!archiveDsAccessAllowed) {
                status.error = `${request.archiveDataSetName} dataset access denied`;
                res.status(403).json(status);
                return
            }
            let dbAbstraction = new DbAbstraction();
            status = await dbAbstraction.archiveData(request.sourceDataSetName, request.collectionName, request.archiveDataSetName, request.cutOffDate);
        }
        if (status.error) {
            status.error = status.error.message;
            status.exampleRequestSpecification = {
                "sourceDataSetName": "<Dataset name whose documents to be archived>",
                "collectionName": "The collection which needs to be archived. If not provided, defaults to `data`",
                "archiveDataSetName": "<Dataset name where the archive docs should go>",
                "cutOffDate": "Date in format dd-mm-yyyy"
            }
            status.exampleRequestBody = {
                "sourceDataSetName": "abc",
                "collectionName": "data",
                "archiveDataSetName": "abc_archive",
                "cutOffDate": "17-11-2024"
            }
            res.status(400).send(status);
            return;
        }
        res.status(200).send(status);
    } catch (err) {
        logger.error({requestId: req.requestId, err}, "Exception while archiving");
        res.status(415).send(err);
    }
})

router.get('/view/columns/:dsName/:dsView/:dsUser', async (req, res, next) => {
    let request = req.body;
    //logger check
    logger.info({requestId: req.requestId, request}, "Incoming request to get columns for view");
    logger.info({requestId: req.requestId, params: req.params}, `Params In columns`);
    logger.info({requestId: req.requestId, query: req.query}, `Query In columns`);
    const token = req.cookies.jwt;
    let allowed = await AclCheck.aclCheck(req.params.dsName, req.params.dsView, req.params.dsUser, token);
    if (!allowed) {
        res.status(403).json({ "Error": "access_denied" });
        return
    }
    // XXX: Do lots of validation.
    let dbAbstraction = new DbAbstraction();
    let response = await dbAbstraction.find(req.params.dsName, "metaData", { _id: `view_${req.params.dsView}` }, {} );
    if (!response || !response[0]) {
        res.status(200).json({});
        return
    }
    let keys = await dbAbstraction.find(req.params.dsName, "metaData", { _id: `keys` }, {} );
    let jiraConfig = await dbAbstraction.find(req.params.dsName, "metaData", { _id: `jiraConfig` }, {} );
    jiraConfig = jiraConfig[0]
    let jiraAgileConfig = await dbAbstraction.find(req.params.dsName, "metaData", { _id: `jiraAgileConfig` }, {});
    jiraAgileConfig = jiraAgileConfig[0]
    let dsDescription = await dbAbstraction.find(req.params.dsName, "metaData", { _id: `dsDescription` }, {} );
    dsDescription = dsDescription[0]
    let otherTableAttrs = await dbAbstraction.find(req.params.dsName, "metaData", { _id: `otherTableAttrs` }, {} );
    if (otherTableAttrs.length)
        otherTableAttrs = otherTableAttrs[0];
    let filters = await dbAbstraction.find(req.params.dsName, "metaData", { _id: `filters` }, {} );
    logger.info({requestId: req.requestId, filters}, "Filters in view columns");
    filters = filters[0]
    let aclConfig = await dbAbstraction.find(req.params.dsName, "metaData", { _id: `aclConfig` }, {} );
    logger.info({requestId: req.requestId, aclConfig}, "AclConfig in view columns");
    if (aclConfig.length)
        aclConfig = aclConfig[0]
    try {
        if (Object.keys(response[0].columnAttrs).length == 0 || response[0].columnAttrs.length == 0) {
            // Do something here and set the columnAttrs?
        }
    } catch (e) {};
    let perRowAccessConfig = await dbAbstraction.find(req.params.dsName, "metaData", { _id: `perRowAccessConfig` }, {} );
    logger.info({requestId: req.requestId, perRowAccessConfig}, "PerRowAccessConfig in view columns");
    perRowAccessConfig = perRowAccessConfig[0]
    let jiraProjectName = await dbAbstraction.find(req.params.dsName, "metaData", { _id: `jiraProjectName` }, {});
    jiraProjectName = (jiraProjectName && jiraProjectName.length == 1 && jiraProjectName[0].jiraProjectName) ? jiraProjectName[0].jiraProjectName : "";
    res.status(200).json({ columns: response[0].columns, columnAttrs: response[0].columnAttrs, keys: keys[0].keys, jiraConfig, dsDescription, filters, otherTableAttrs, aclConfig, jiraAgileConfig, jiraProjectName, perRowAccessConfig });
    return;
});

async function pager (req, res, collectionName) {
    let request = req.body;
    let query;
    if (req.method === 'GET')
        query = req.query;
    else
        query = request;
    logger.info({requestId: req.requestId, request}, "Incoming request to pager");
    //logger.info("In pager, req:", req);
    logger.info({requestId: req.requestId, params: req.params}, "In pager, req.params");
    logger.info({requestId: req.requestId, query}, "In pager, query");
    logger.info({requestId: req.requestId, collectionName}, "In pager, collectionName");
    const token = req.cookies.jwt;
    let allowed = await AclCheck.aclCheck(req.params.dsName, req.params.dsView, req.params.dsUser, token);
    if (!allowed) {
        res.status(403).json({ "Error": "access_denied" });
        return
    }
    let onlyPerRowAccessCtrlQueried = false;
    [query.filters, onlyPerRowAccessCtrlQueried] = await PerRowAcessCheck.enforcePerRowAcessCtrl(req.params.dsName, req.params.dsView, req.params.dsUser, query.filters);
    logger.info({requestId: req.requestId, query}, "In pager, after enforcePerRow query");
    let [filters, sorters] = MongoFilters.getMongoFiltersAndSorters(query.filters, query.sorters, query.chronology);

    // XXX: Do lots of validation.
    logger.info({requestId: req.requestId, filters}, "In pager, mongo filters");
    logger.info({requestId: req.requestId, sorters}, "In pager, mongo sorters");
    let options = {};
    // @ts-ignore
    if (sorters.length)
        options.sort = sorters;
    let dbAbstraction = new DbAbstraction();
    let response = {};
    try {
        let fetchAllMatchingRecords = (query.fetchAllMatchingRecords && query.fetchAllMatchingRecords.toLowerCase() === 'true');
        // @ts-ignore
        response = await dbAbstraction.pagedFind(req.params.dsName, collectionName, filters, options, parseInt(query.page), parseInt(query.per_page), fetchAllMatchingRecords, onlyPerRowAccessCtrlQueried);
        response.reqCount = query.reqCount || 0;
    } catch (e) {
        logger.error({requestId: req.requestId, err: e}, "Exception in pager: ");
    }
    res.status(200).json(response);
}

router.get('/view/attachments/:dsName/:dsView/:dsUser', async (req, res, next) => {
    await pager(req, res, "attachments");
});


router.get('/view/editLog/:dsName/:dsView/:dsUser', async (req, res, next) => {
    await pager(req, res, "editlog");
});

router.get('/view/:dsName/:dsView/:dsUser', async (req, res, next) => {
    await pager(req, res, "data");
});

router.get('/view/:dsName/:dsView/:dsUser/:id', async (req, res, next) => {
    logger.info({requestId: req.requestId}, "In view for dsUser");
    let dsName = req.params.dsName;
    let dsView = req.params.dsView;
    let dsUser = req.params.dsUser;
    let _id = req.params.id;
    if (!dsName || !dsView || !dsUser || !_id) {
        res.status(404).json({ "Error": "Invalid request" });
        return;
    }
    let token = req.cookies.jwt;
    logger.info({requestId: req.requestId}, `Got request for ${dsName} by ${dsUser} for id ${_id} and view ${dsView}`);
    let allowed = await AclCheck.aclCheck(req.params.dsName, req.params.dsView, req.params.dsUser, token);
    if (!allowed) {
        res.status(403).json({ "Error": "access_denied" });
        return;
    }
    let qFilters = [ {field: "_id", type: "eq", value: new ObjectId(_id)} ];
    [qFilters] = await PerRowAcessCheck.enforcePerRowAcessCtrl(req.params.dsName, req.params.dsView, req.params.dsUser, qFilters);
    logger.info({requestId: req.requestId, qFilters}, "In single-user query end-point, after enforcePerRow, qFilters");
    let [filters, sorters] = MongoFilters.getMongoFiltersAndSorters(qFilters, null, null);
    logger.info({requestId: req.requestId, filters}, "In single-user query end-point, mongoFilters");

    let response = {};
    let dbAbstraction = new DbAbstraction();
    try {
        let data = await dbAbstraction.find(dsName, "data", filters, {});
        response.reqCount = 0;
        response.data = data;
        response.total = data.length;
    } catch (e) {
        logger.error({requestId: req.requestId, err: e}, 'Exception while getting the data from id');
    }
    res.status(200).json(response);
});

// To ensure no conflicts. Retaining this for backward compatibility for APIs. 
// This will only work when there is no ACL for the dataset. 
router.post('/viewViaPost/:dsName', async (req, res, next) => {
    await pager(req, res, "data");
});

// Use this for ACL enabled dataset via APIs. 
router.post('/viewViaPost/:dsName/:dsView/:dsUser', async (req, res, next) => {
    await pager(req, res, "data");
});


// To ensure no conflicts. Retaining this for backward compatibility for APIs. 
// This will only work when there is no ACL for the dataset. 
router.post('/viewViaPost/editLog/:dsName', async (req, res, next) => {
    await pager(req, res, "editlog");
});

// Use this for ACL enabled dataset via APIs. 
router.post('/viewViaPost/editLog/:dsName/:dsView/:dsUser', async (req, res, next) => {
    await pager(req, res, "editlog");
});

// To ensure no conflicts. Retaining this for backward compatibility for APIs. 
// This will only work when there is no ACL for the dataset. 
router.post('/viewViaPost/attachments/:dsName', async (req, res, next) => {
    await pager(req, res, "attachments");
});

// Use this for ACL enabled dataset via APIs. 
router.post('/viewViaPost/attachments/:dsName/:dsView/:dsUser', async (req, res, next) => {
    await pager(req, res, "attachments");
});

router.post('/deleteFromQuery/:dsName/:dsView/:dsUser', async (req, res, next) => {
    logger.info({requestId: req.requestId}, "Incoming request to deleteFromQuery");
    let request = req.body;
    let query = req.query;
    logger.info({requestId: req.requestId, params: req.params}, "Request params in deleteFromQuery:");
    logger.info({requestId: req.requestId, query}, "Incoming query In deleteFromQuery");
    const token = req.cookies.jwt;
    let allowed = await AclCheck.aclCheck(req.params.dsName, req.params.dsView, req.params.dsUser, token);
    if (!allowed) {
        res.status(403).json({ "Error": "access_denied" });
        return
    }
    [query.filters] = await PerRowAcessCheck.enforcePerRowAcessCtrl(req.params.dsName, req.params.dsView, req.params.dsUser, query.filters);
    let [filters, sorters] = MongoFilters.getMongoFiltersAndSorters(query.filters, query.sorters, query.chronology);
    logger.info({requestId: req.requestId, filters}, "Mongo filters in deleteFromQuery");
    logger.info({requestId: req.requestId, sorters}, "Mongo sorters in deleteFromQuery");
    let options = {};
    // @ts-ignore
    if (sorters.length)
        options.sort = sorters;
    let dbAbstraction = new DbAbstraction();
    let response = {};
    try {
        // @ts-ignore
        response.total = await dbAbstraction.countDocuments(req.params.dsName, "data", filters, options);
    } catch (e) {
        logger.error({requestId: req.requestId, err: e}, "Exception in pager");
    }
    if (query.pretend == 'false' || query.pretend == false) {
        let count = 0;
        count = await dbAbstraction.removeFromQuery(req.params.dsName, "data", filters, options);
        // @ts-ignore
        response = {};
        response.count = count;
    }
    logger.info({requestId: req.requestId, response}, "Response in deleteFromQuery");
    res.status(200).json(response);
});



function getSingleEditLog (req, isKey, status) {
    let selectorObj = JSON.parse(JSON.stringify(req.selectorObj));
    let editObj = JSON.parse(JSON.stringify(req.editObj));
    //column, oldVal, newVal, user, selector, date
    let editDoc = {};
    editDoc.opr = "edit";
    editDoc.editedRowId = selectorObj._id;
    delete selectorObj._id;
    editDoc.selector = JSON.stringify(selectorObj, null, 4);
    editDoc.column = req.column;
    editDoc.oldVal = selectorObj[req.column];
    editDoc.newVal = editObj[req.column];
    editDoc.user = req.dsUser;
    editDoc.date = Date();
    editDoc.status = status;
    return editDoc;
}

function getInsertLog (req, status) {
    let insertDoc = {};
    insertDoc.opr = "insert";
    insertDoc.selector = JSON.stringify(req.selectorObj, null, 4);
    insertDoc.doc = JSON.stringify(req.doc, null, 4);
    insertDoc.user = req.dsUser;
    insertDoc.date = Date();
    insertDoc.status = status;
    return insertDoc;
}

function getDeleteLog (req, _doc, status) {
    let selectorObj = JSON.parse(JSON.stringify(req.selectorObj));
    logger.info({requestId: req.requestId, doc: _doc}, `In getDeleteLog`);
    let doc = JSON.parse(JSON.stringify(_doc));
    let deleteDoc = {};
    deleteDoc.opr = "delete";
    delete selectorObj._id;
    deleteDoc.selector = JSON.stringify(selectorObj, null, 4);
    delete doc._id;
    deleteDoc.doc = JSON.stringify(doc, null, 4);
    deleteDoc.user = req.dsUser;
    deleteDoc.date = Date();
    deleteDoc.status = status;
    return deleteDoc;
}

router.post('/view/editSingleAttribute', async (req, res, next) => {
    let request = req.body;
    logger.info({requestId: req.requestId, request}, "Incoming Request in editSingleAttribute");
    const token = req.cookies.jwt;
    let allowed = await AclCheck.aclCheck(request.dsName, request.dsView, request.dsUser, token);
    if (!allowed) {
        res.status(403).json({ "Error": "access_denied" });
        return
    }
    let dbAbstraction = new DbAbstraction();
    try {
        // XXX: Do lots of validation.
        let response = {}
        let recs = await PerRowAcessCheck.checkAccessForSpecificRow(request.dsName, request.dsView, request.dsUser, new ObjectId(request.selectorObj._id));
        // @ts-ignore
        if (recs.length == 1) {
            let isJiraAgileRow = isJiraAgileRec(recs[0])
            if (isJiraAgileRow) {
                logger.info({requestId: req.requestId}, "Edit Jira Agile Row");
                let resp = await JiraAgile.editSingleAttribute(req)
                response.status = resp.status
                response.error = resp.error
                if (resp.record) response.record = resp.record
                res.status(200).send(response);
                return
            }
            let isJiraRow = isJiraRec(recs[0]);
            if (isJiraRow) {
                logger.info({requestId: req.requestId}, "Edit Jira Row");
                let resp = await JiraFieldEdit.editSingleAttribute(req)
                response.status = resp.status
                response.error = resp.error
                if (resp.record) response.record = resp.record
                res.status(200).send(response);
                return
            }
        } else {
            response.status = 'fail';
            response.error = 'Row not found!';
            res.status(200).send(response);
            return
        }
        let keys = await dbAbstraction.find(request.dsName, "metaData", { _id: `keys` }, {} );
        let keyBeingEdited = false;
        let editObjKeys = Object.keys(request.editObj)
        for (let i = 0; i < editObjKeys.length; i++) {
            let key = editObjKeys[i];
            for (let j = 0; j < keys[0].keys.length; j++) {
                if (keys[0].keys[j] === key) {
                    keyBeingEdited = true;
                    break;
                }
            }
        }
        if (keyBeingEdited) {
            logger.info({requestId: req.requestId}, "A key is being edited: Do in transaction");
            // Selector obj must contain all the keys for this case. Send this from the UI. 
            // Look for an obj with all those keys. If one exists, then fail the edit. Else
            // update the object. 
            let dbResponse = await dbAbstraction.updateOneKeyInTransaction(request.dsName, "data", request.selectorObj, request.editObj);
            if (dbResponse.nModified == 1) {
                response.status = 'success';
            } else {
                response.status = 'fail';
                response.error = 'Key conflict';
            }
        } else {
            let dbResponse = await dbAbstraction.updateOne(request.dsName, "data", request.selectorObj, request.editObj);
            logger.info({requestId: req.requestId, dbResponse}, 'Edit response');
            if (dbResponse.nModified == 1) {
                response.status = 'success';
            } else {
                response.status = 'fail';
                // Assumes that selector definitely has the '_id' field. 
                if (request.selectorObj._id) {
                    // XXX: It works because updateOne call above fixed the _id format inside
                    // selectorObj! 
                    let recs = await dbAbstraction.find(request.dsName, "data", { _id: request.selectorObj._id }, { } );
                    if (recs.length == 1) {
                        response._id = request.selectorObj._id;
                        response.column = request.column;
                        response.value = recs[0][request.column];
                    } else {
                        response.error = 'Row not found!';
                    }
                }
            }
        }
        let editLog = getSingleEditLog(request, keyBeingEdited, response.status);
        let editLogResp = await dbAbstraction.insertOne(request.dsName, "editlog", editLog);
        logger.info({requestId: req.requestId, editLogResp}, 'editLog (edit) response');
        // XXX: If response fails, do a 'find' query and return the updated attribute.
        res.status(200).send(response);
    } catch (e) {
        logger.error({requestId: req.requestId, err: e}, "Exception in editing singleAttribute");
        res.status(415).send(e);
    }
});

function isJiraAgileRec(rec) {
    let isJiraAgileRec = false
    let jiraUrl = "https://" + host;
    for (let [key, value] of Object.entries(rec)) {
        let regex = new RegExp(`\\[(JIRA_AGILE).*${jiraUrl + '/browse/'}`)
        if (typeof value == "string") {
            if (regex.test(value)) {
                isJiraAgileRec = true
            }
        }
    }
    return isJiraAgileRec
}

function isJiraRec(rec) {
    let isJiraRec = false
    let jiraUrl = "https://" + host;
    for (let [key, value] of Object.entries(rec)) {
        let regex = new RegExp(`\\[(?!JIRA_AGILE).*${jiraUrl + '/browse/'}`)
        if (typeof value == "string") {
            if (regex.test(value)) {
                isJiraRec = true
            }
        }
    }
    return isJiraRec
}

router.post('/view/insertOneDoc', async (req, res, next) => {
    let request = req.body;
    logger.info({requestId: req.requestId}, "Incoming request in insertOneDoc");
    const token = req.cookies.jwt;
    let allowed = await AclCheck.aclCheck(request.dsName, request.dsView, request.dsUser, token);
    if (!allowed) {
        res.status(403).json({ "Error": "access_denied" });
        return
    }
    let dbAbstraction = new DbAbstraction();
    try {
        // XXX: Do lots of validation.
        let dbResponse = await dbAbstraction.insertOneUniquely(request.dsName, "data", request.selectorObj, request.doc);
        logger.info({requestId: req.requestId, dbResponse}, 'DB response after insertOneUniquely');
        let response = {};
        if (dbResponse.ok == 1 && dbResponse.upserted && dbResponse.upserted.length == 1) {
            response.status = 'success';
            response._id = dbResponse.upserted[0]._id;
        } else {
            response.status = 'fail';
            // Assumes that selector definitely has the '_id' field. 
            if (request.selectorObj._id) {
                let recs = await dbAbstraction.find(request.dsName, "data", { _id: request.selectorObj._id }, { } );
                if (recs.length == 1) {
                    response._id = request.selectorObj._id;
                    response.column = request.column;
                    response.value = recs[0][request.column];
                }
            }
        }
        let editLog = getInsertLog(request, response.status);
        let editLogResp = await dbAbstraction.insertOne(request.dsName, "editlog", editLog);
        logger.info({requestId: req.requestId, editLogResp}, 'editLog (insert) response');
        // XXX: If response fails, do a 'find' query and return the updated attribute.
        res.status(200).send(response);
    } catch (e) {
        logger.error({requestId: req.requestId, err: e}, "Exception in insertOneDoc");
        res.status(415).send(e);
    }
});

// XXX: Wonder who uses this api? It doesn't seem to be used from 
// the front end for sure. 
router.post('/view/insertOrUpdateOneDoc', async (req, res, next) => {
    let request = req.body;
    logger.info({requestId: req.requestId}, "Incoming request in insertOrUpdateOneDoc");
    //res.status(200).send({status: 'success'});
    //return;
    const token = req.cookies.jwt;
    let allowed = await AclCheck.aclCheck(request.dsName, request.dsView, request.dsUser, token);
    if (!allowed) {
        res.status(403).json({ "Error": "access_denied" });
        return
    }
    let dbAbstraction = new DbAbstraction();
    try {
        // XXX: Do lots of validation.
        if (request.selectorObj._id) {
            request.selectorObj._id = dbAbstraction.getObjectId(request.selectorObj._id);
            request.doc._id = request.selectorObj._id;
            let recs = await PerRowAcessCheck.checkAccessForSpecificRow(request.dsName, request.dsView, request.dsUser, request.selectorObj._id);
            // @ts-ignore
            if (recs.length == 0) {
                let response = { status: 'fail', error: 'Row not found!'}
                res.status(200).send(response);
                return    
            }
        }
        let dbResponse = await dbAbstraction.update(request.dsName, "data", request.selectorObj, request.doc);
        logger.info({requestId: req.requestId, dbResponse}, 'DB response after insertOrUpdateOneDoc');
        let response = {};
        if (dbResponse.result.ok == 1) {
            response.status = 'success';
            if (dbResponse.result.upserted) {
                //logger.info ('insertOrUpdateOneDoc, upserted: ', JSON.stringify(dbResponse.result.upserted, null, 4));
                response._id = dbResponse.result.upserted[0]._id;
            }
        } else {
            response.status = 'fail';
            // Assumes that selector definitely has the '_id' field. 
            if (request.selectorObj._id) {
                let recs = await dbAbstraction.find(request.dsName, "data", { _id: request.selectorObj._id }, { } );
                if (recs.length == 1) {
                    response._id = request.selectorObj._id;
                    response.column = request.column;
                    response.value = recs[0][request.column];
                }
            }
        }
        //let editLog = getInsertLog(request, response.status);
        //let editLogResp = await dbAbstraction.insertOne(request.dsName, "editlog", editLog);
        //logger.info('editLog (insert) response: ', editLogResp);
        // XXX: If response fails, do a 'find' query and return the updated attribute.
        res.status(200).send(response);
    } catch (e) {
        logger.error({requestId: req.requestId, err: e}, "Got exception in insertOrUpdateOneDoc");
        res.status(415).send(e);
    }
});


router.post('/downloadXlsx/:dsName/:dsView/:dsUser', async (req, res, next) => {
    // In this API, the request.query has filters directly. So, you have to use it accordingly.
    let request = req.body;
    logger.info({requestId: req.requestId, request}, "Incoming request to downloadXlsx");
    let filters = request.query, sorters;
    logger.info({requestId: req.requestId, params: req.params}, "In downloadXlsx, req.params");
    logger.info({requestId: req.requestId, filters}, "In downloadXlsx, query");
    const token = req.cookies.jwt;
    let allowed = await AclCheck.aclCheck(req.params.dsName, req.params.dsView, req.params.dsUser, token);
    if (!allowed) {
        res.status(403).json({ "Error": "access_denied" });
        return
    }
    let mongoFilters;
    if (filters.length == 1 && filters[0].field === '_id') {
        // XXX: What is this use-case? I think unnecessary to allow
        // downloadXlsx for just one row really. Not fully tested. 
        if (!filters[0].value) {
            logger.warn({requestId: req.requestId}, "Error: Id not found in download single row");
            res.status(400).json({ "Error": "Id not found" });
            return
        }
        let qFilters = [ {field: "_id", type: "eq", value: new ObjectId(filters[0].value)} ];
        [qFilters] = await PerRowAcessCheck.enforcePerRowAcessCtrl(req.params.dsName, req.params.dsView, req.params.dsUser, qFilters);
        [mongoFilters, sorters] = MongoFilters.getMongoFiltersAndSorters(qFilters, null, null);
    } else {
        [filters] = await PerRowAcessCheck.enforcePerRowAcessCtrl(req.params.dsName, req.params.dsView, req.params.dsUser, filters);
        [mongoFilters, sorters] = MongoFilters.getMongoFiltersAndSorters(filters, null, null);
    }
    logger.info({requestId: req.requestId, mongoFilters}, "In downloadxlsx : mongo filters");
    let options = {};
    // @ts-ignore
    if (sorters.length)
        options.sort = sorters;
    let fileName = `export_${req.params.dsName}_${req.params.dsView}_${req.params.dsUser}.xlsx`
    await ExcelUtils.exportDataFromDbIntoXlsx(req.params.dsName, req.params.dsView, req.params.dsUser, fileName, mongoFilters, options);
    try {
        let bits = fs.readFileSync(fileName);
        // convert binary data to base64 encoded string
        let base64Str = new Buffer(bits).toString('base64');
        res.json({output: base64Str});
        fs.unlinkSync(fileName);
    } catch (e) {
        logger.error({requestId: req.requestId, err: e}, "Exception in DownloadXlsx");
    }
});


router.get('/dsList/:dsUser', async (req, res, next) => {
    let request = req.body;
    logger.info({requestId: req.requestId}, "Incoming request in dsList");
    logger.info({requestId: req.requestId, params: req.params}, "Params in dsList");
    logger.info({requestId: req.requestId, query: req.query}, "Query in dsList");

    let dbAbstraction = new DbAbstraction();
    let dbList = await dbAbstraction.listDatabases();
    let pruned = [];
    let sysDbs = ['admin', 'config', 'local'];
    for (let i = 0; i < dbList.length; i++) {
        let j = sysDbs.indexOf(dbList[i].name);
        if (j > -1)
            continue;

        let aclConfig = await dbAbstraction.find(dbList[i].name, 'metaData', { _id: "aclConfig" });
        aclConfig = aclConfig[0];
        if (aclConfig && aclConfig.accessCtrl && !aclConfig.acl.includes(req.params.dsUser)) {
            continue;
        }
        pruned.push(dbList[i]);
    }
    for (let i = 0; i < pruned.length; i++) {
        let perms = await dbAbstraction.find(pruned[i].name, 'metaData', { _id: "perms" });
        pruned[i].perms = perms[0];
    }
    pruned.sort((a, b) => a.name.localeCompare(b.name));
    logger.info({requestId: req.requestId, pruned}, "Returning dsList");
    res.json({ dbList: pruned });
});

router.post("/dsList/:dsUser", async (req, res, next) => {
    let request = req.body;
    if (!request.dsFilter) {
        res.status(403).json({ Error: "no filter given" });
        return;
    }
    // Do somepreprocessing with the filter
    let incomingFilter = request.dsFilter;
    let charArr = incomingFilter.split("-");
    //Make sure the filter is given in proper format like "A-G", "1-3" etc.
    if (charArr.length !== 2) {
        res
            .status(403)
            .json({ Error: "bad filter given. Filter should be like A-G, 1-5" });
        return;
    }
    let startChar = charArr[0];
    let endChar = charArr[1];
    if (startChar.length !== 1 || endChar.length !== 1) {
        res
            .status(403)
            .json({ Error: "bad filter given. Filter should be like A-G, 1-5" });
        return;
    }
    /* The filter provided to dbAbstraction method should always be in uppercase. 
      Since, if the user provides something like "A-n", it will also match "S" and "s". Reason being
      the ascii char value of "S" comes within "A-n" range and the listFilteredDatabases ignores case while matching.
      */
    startChar = startChar.toUpperCase();
    endChar = endChar.toUpperCase();
    let filter = `${startChar}-${endChar}`;
    let dbAbstraction = new DbAbstraction();
    let dbList = await dbAbstraction.listFilteredDatabases(filter);
    let pruned = [];
    let sysDbs = ["admin", "config", "local"];
    for (let i = 0; i < dbList.length; i++) {
        let j = sysDbs.indexOf(dbList[i].name);
        // Get rid of system databases
        if (j > -1) continue;

        let aclConfig = await dbAbstraction.find(dbList[i].name, "metaData", {
            _id: "aclConfig",
        });
        aclConfig = aclConfig[0];
        // Get rid of dbs for which current user doesn't have access.
        if (
            aclConfig &&
            aclConfig.accessCtrl &&
            !aclConfig.acl.includes(req.params.dsUser)
        ) {
            continue;
        }
        pruned.push(dbList[i]);
    }
    for (let i = 0; i < pruned.length; i++) {
        let perms = await dbAbstraction.find(pruned[i].name, "metaData", {
            _id: "perms",
        });
        pruned[i].perms = perms[0];
    }
    // return the databases list
    pruned.sort((a, b) => a.name.localeCompare(b.name));
    res.json({ dbList: pruned });
});

router.post('/deleteDs', async (req, res, next) => {
    let request = req.body;
    logger.info({requestId: req.requestId, request}, "Incoming request in deleteDs");
    const token = req.cookies.jwt;
    let allowed = await AclCheck.aclCheck(request.dsName, request.dsView, request.dsUser, token);
    if (!allowed) {
        res.status(403).json({ "Error": "access_denied" });
        return
    }
    let dbAbstraction = new DbAbstraction();
    try {
        // XXX: Do lots of validation.
        let dbResponse = await dbAbstraction.deleteDb(request.dsName);
        logger.info({requestId: req.requestId, dbResponse}, 'DeleteDs response from DB');
        // @ts-ignore
        fs.rmdirSync(`attachments/${request.dsName}`, { recursive: true });
        let response = {};
        response.status = 'success';
        res.status(200).send(response);
    } catch (e) {
        logger.error({requestId: req.requestId, err: e}, "Exception in deleteDs");
        res.status(415).send(e);
    }
});

router.post('/view/addColumn', async (req, res, next) => {
    try {
        logger.info({requestId: req.requestId, body: req.body}, "Incoming request in addColumn");

        const { dsName, dsView, dsUser, columnName, position, referenceColumn } = req.body;

        if (!dsName || !dsView || !dsUser || !columnName || !position || !referenceColumn) {
            logger.warn({requestId: req.requestId}, "Missing required parameters!");
            return res.status(400).json({ error: "Missing required parameters" });
        }

        // Check User Permissions
        const token = req.cookies.jwt;
        let allowed = await AclCheck.aclCheck(dsName, dsView, dsUser, token);
        if (!allowed) {
            logger.warn({requestId: req.requestId}, `Access Denied for user: ${dsUser}`);
            return res.status(403).json({ error: "Access Denied" });
        }
        let dbAbstraction = new DbAbstraction();
        let viewDefault = await dbAbstraction.find(dsName, "metaData", { _id: "view_default" }, {});

        if (!viewDefault || !viewDefault.length) {
            logger.warn({requestId: req.requestId}, `View metadata not found for: ${dsName}`);
            return res.status(404).json({ error: "View metadata not found" });
        }

        let metadata = viewDefault[0];
        let columns = metadata.columns || {};
        let columnAttrsList = metadata.columnAttrs || [];

        if (Object.values(columns).includes(columnName)) {
            logger.error({requestId: req.requestId}, `Column already exists: ${columnName}`);
            return res.status(400).json({ error: "Column already exists" });
        }

        logger.info({requestId: req.requestId}, "Processing column addition...");
        let newColumns = {};
        let newColumnAttrs = [];
        let foundReference = false;

        // Find the reference column's attributes
        let referenceColumnAttr = columnAttrsList.find(attr => attr.field === referenceColumn);
        
        // Construct new column attributes based on reference attributes
        let newColumnAttr = referenceColumnAttr
            ? {
                field: columnName,
                title: columnName,
                width: referenceColumnAttr.width || 150,
                editor: referenceColumnAttr.editor || "textarea",
                editorParams: { ...referenceColumnAttr.editorParams },
                formatter: referenceColumnAttr.formatter || "textarea",
                headerFilterType: referenceColumnAttr.headerFilterType || "input",
                hozAlign: referenceColumnAttr.hozAlign || "center",
                vertAlign: referenceColumnAttr.vertAlign || "middle",
                headerTooltip: referenceColumnAttr.headerTooltip !== undefined ? referenceColumnAttr.headerTooltip : true
              }
            : { 
                field: columnName, title: columnName, width: 150, editor: "textarea",
                editorParams: {}, formatter: "textarea", headerFilterType: "input",
                hozAlign: "center", vertAlign: "middle", headerTooltip: true
              };

        let newColumnsKey = 1;
        let oldColumnsAttrsLen = Object.keys(columnAttrsList).length;
        for (let i = 0; i < oldColumnsAttrsLen; i++ ) {
            let colName = columnAttrsList[i].field;
            if (colName === referenceColumn) {
                foundReference = true;
                if (position === "left") {
                    newColumns[newColumnsKey] = columnName;
                    newColumnAttrs.push(newColumnAttr);
                    newColumnsKey++;
                }
                newColumns[`${newColumnsKey}`] = colName;
                newColumnAttrs.push(columnAttrsList.find(attr => attr.field === colName) || {});
                newColumnsKey++;
                if (position === "right") {
                    newColumns[newColumnsKey] = columnName;
                    newColumnAttrs.push(newColumnAttr);
                    newColumnsKey++;
                }
            } else {
                newColumns[newColumnsKey] = colName;
                newColumnAttrs.push(columnAttrsList.find(attr => attr.field === colName) || {});
                newColumnsKey++;
            }
        }

        // If reference column was not found, add the new column at the end
        if (!foundReference) {
            logger.warn({requestId: req.requestId}, `Reference column '${referenceColumn}' not found. Adding '${columnName}' at the end.`);
            newColumns[newColumnsKey] = columnName;
            newColumnAttrs.push(newColumnAttr);
        }

        logger.info({requestId: req.requestId}, "Updating metadata...");
        metadata.columns = newColumns;
        metadata.columnAttrs = newColumnAttrs;

        const updateResult = await dbAbstraction.update(dsName, "metaData", { _id: "view_default" }, metadata);
        if (!updateResult || updateResult.modifiedCount === 0) {
            logger.error({requestId: req.requestId}, "Failed to update metadata.");
            return res.status(500).json({ error: "Failed to update metadata" });
        }

        // Update filters
        logger.info({requestId: req.requestId}, "Updating filters...");
        let filters = await dbAbstraction.find(dsName, "metaData", { _id: "filters" }, {});
        filters = filters[0] || {};
        let filterKeys = Object.keys(filters);
        
        for (let filterKey of filterKeys) {
            if (filterKey === "_id") continue;
            let filterObj = filters[filterKey];
            filterObj.filterColumnAttrs = filterObj.filterColumnAttrs || {};
            filterObj.filterColumnAttrs[columnName] = { hidden: true, width: newColumnAttr.width };
        }

        if (filterKeys.length)
            await dbAbstraction.updateOne(dsName, "metaData", { _id: "filters" }, filters, false);

        logger.info({requestId: req.requestId}, `Column added successfully: ${columnName}`);
        return res.status(200).json({ message: "Column added successfully", columnName });
    } catch (error) {
        logger.error({requestId: req.requestId, err: error}, "Error in addColumn API");
        return res.status(500).json({ error: "Internal Server Error", details: error.toString() });
    }
});

// deletion of column api
router.post('/view/deleteColumn', async (req, res) => {
    let request = req.body;
    logger.info({requestId: req.requestId, request}, "Incoming request in deleteColumn");

    const token = req.cookies.jwt;
    let allowed = await AclCheck.aclCheck(request.dsName, request.dsView, request.dsUser, token);
    if (!allowed) {
        return res.status(403).json({ "Error": "access_denied" });
    }

    let dbAbstraction = new DbAbstraction();
    try {
        let columnName = request.columnName;
        let oprLog = [];

        // Check if the column is a key column
        let keys = await dbAbstraction.find(request.dsName, "metaData", { _id: `keys` }, {});
        if (keys[0].keys.includes(columnName)) {
            return res.status(400).json({ error: `Cannot delete key column: "${columnName}"` });
        }
        let delCols = { [columnName]: true }; // Using delColKeys approach

        // Fetch existing columns
        let viewDefault = await dbAbstraction.find(request.dsName, "metaData", { _id: `view_default` }, {});
        let columns = viewDefault[0].columns;
        let columnAttrs = viewDefault[0].columnAttrs;

        // Remove column from metadata
        let newColumns = {};
        let newColumnAttrs = [];
        let j = 1;
        for (let i in columns) {
            if (columns[i] in delCols) continue;
            newColumns[j] = columns[i];
            j++;
        }

        for (let attr of columnAttrs) {
            if (attr.field in delCols) continue;
            newColumnAttrs.push(attr);
        }

        oprLog.push(`Deleted column: "${columnName}"`);

        // Update metadata
        await dbAbstraction.update(request.dsName, "metaData", { _id: `view_default` }, { columns: newColumns, columnAttrs: newColumnAttrs, userColumnAttrs: viewDefault[0].userColumnAttrs });

        // Remove column from filters
        let filters = await dbAbstraction.find(request.dsName, "metaData", { _id: `filters` }, {});
        filters = filters[0] || {};
        let filterKeys = Object.keys(filters);

        for (let filterKey of filterKeys) {
            if (filterKey === "_id") continue;
            let filterObj = filters[filterKey];
            delete filterObj.filterColumnAttrs[columnName];

            filterObj.hdrFilters = filterObj.hdrFilters.filter(f => f.field !== columnName);
            filterObj.hdrSorters = filterObj.hdrSorters.filter(s => s.column !== columnName);
        }

        if (filterKeys.length) {
            await dbAbstraction.updateOne(request.dsName, "metaData", { _id: 'filters' }, filters, false);
        }

        // Remove column from Jira config
        let jiraConfig = await dbAbstraction.find(request.dsName, "metaData", { _id: `jiraConfig` }, {});
        jiraConfig = jiraConfig[0];
        if (jiraConfig) {
            for (let jiraKey in jiraConfig.jiraFieldMapping) {
                if (jiraConfig.jiraFieldMapping[jiraKey] === columnName) {
                    oprLog.push(`Dropped "${columnName}" from jira-mapping for jira-key: "${jiraKey}"`);
                    delete jiraConfig.jiraFieldMapping[jiraKey];
                }
            }

            await dbAbstraction.update(request.dsName, "metaData", { _id: "jiraConfig" }, jiraConfig);
        }

        // Remove column from Jira Agile config
        let jiraAgileConfig = await dbAbstraction.find(request.dsName, "metaData", { _id: `jiraAgileConfig` }, {});
        jiraAgileConfig = jiraAgileConfig[0];
        if (jiraAgileConfig) {
            for (let jiraKey in jiraAgileConfig.jiraFieldMapping) {
                if (jiraAgileConfig.jiraFieldMapping[jiraKey] === columnName) {
                    oprLog.push(`Dropped "${columnName}" from jira-agile-mapping for jira-key: "${jiraKey}"`);
                    delete jiraAgileConfig.jiraFieldMapping[jiraKey];
                }
            }

            await dbAbstraction.update(request.dsName, "metaData", { _id: "jiraAgileConfig" }, jiraAgileConfig);
        }

        // Remove column from all data documents
        await dbAbstraction.removeFieldFromAll(request.dsName, "data", columnName);

        res.status(200).json({ message: `Column "${columnName}" deleted successfully`, oprLog });
    } catch (e) {
        logger.error({requestId: req.requestId, err: e}, "Error in deleteColumn");
        res.status(500).send(e);
    }
});
router.post('/view/deleteOneDoc', async (req, res, next) => {
    let request = req.body;
    logger.info({requestId: req.requestId, request}, "Incoming request in deleteOneDoc");
    const token = req.cookies.jwt;
    let allowed = await AclCheck.aclCheck(request.dsName, request.dsView, request.dsUser, token);
    if (!allowed) {
        res.status(403).json({ "Error": "access_denied" });
        return
    }

    let deletedObj = {};
    let dbAbstraction = new DbAbstraction();
    try {
        // XXX: Do lots of validation.
        // First get a copy of the object we are deleting. 
        if (request.selectorObj._id) {
            let _id = dbAbstraction.getObjectId(request.selectorObj._id);
            let recs = await PerRowAcessCheck.checkAccessForSpecificRow(request.dsName, request.dsView, request.dsUser, _id);
            // @ts-ignore
            if (recs.length == 0) {
                res.status(200).send({ status: 'fail', error: 'Row not found!'});
                return;
            }
            deletedObj = recs[0];
            logger.info({requestId: req.requestId, recs}, "In deleteOneDoc end-point, recs");
            logger.info({requestId: req.requestId, deletedObj}, "Object getting deleted");
        }
        let dbResponse = await dbAbstraction.removeOne(request.dsName, "data", request.selectorObj);
        logger.info({requestId: req.requestId, dbResponse}, 'DeleteOne response in deleteOneDoc');
        let response = {};
        response.status = 'success';

        let editLog = getDeleteLog(request, deletedObj, response.status);
        let editLogResp = await dbAbstraction.insertOne(request.dsName, "editlog", editLog);
        logger.info(editLogResp, 'editLog (delete) response');
        // XXX: If response fails, do a 'find' query and return the updated attribute.
        res.status(200).send(response);
    } catch (e) {
        logger.error({requestId: req.requestId, err: e}, "Exception in deleteOneDoc");
        res.status(415).send(e);
    }
});

router.post('/view/deleteManyDocs', async (req, res, next) => {
    let request = req.body;
    logger.info({requestId: req.requestId, request}, "Incoming request in deleteManyDocs");
    //res.status(200).send({status: 'success'});
    //return;
    const token = req.cookies.jwt;
    let allowed = await AclCheck.aclCheck(request.dsName, request.dsView, request.dsUser, token);
    if (!allowed) {
        res.status(403).json({ "Error": "access_denied" });
        return
    }
    let deletedObj = {};
    let dbAbstraction = new DbAbstraction();
    try {
        // XXX: Do lots of validation.
        for (let i = 0; i < request.objects.length; i++) {
            // First get a copy of the object we are deleting. 
            let _id = dbAbstraction.getObjectId(request.objects[i]);
            let recs = await PerRowAcessCheck.checkAccessForSpecificRow(request.dsName, request.dsView, request.dsUser, _id);
            // @ts-ignore
            if (recs.length == 0)
                continue;
            deletedObj = recs[0];
            logger.info({requestId: req.requestId, deletedObj}, "Object getting deleted");
            let dbResponse = await dbAbstraction.removeOne(request.dsName, "data", { _id : request.objects[i] });
            logger.info({requestId: req.requestId, dbResponse}, `deleteManyDocs response for ${request.objects[i]}`);
            let editLog = getDeleteLog({ selectorObj: { _id: request.objects[i] } }, deletedObj, "success");
            let editLogResp = await dbAbstraction.insertOne(request.dsName, "editlog", editLog);
            logger.info({requestId: req.requestId, editLogResp}, `editLog (delete) response for ${request.objects[i]}`);
        }

        let response = {};
        response.status = 'success';
        res.status(200).send(response);
    } catch (e) {
        logger.error({requestId: req.requestId, err: e}, "Exception in deleteManyDocs");
        res.status(415).send(e);
    }
});


router.post('/view/setViewDefinitions', async (req, res, next) => {
    let request = req.body;
    logger.info({requestId: req.requestId, request}, "Incoming request in setViewDefinitions");
    const token = req.cookies.jwt;
    let allowed = await AclCheck.aclCheck(request.dsName, request.dsView, request.dsUser, token);
    if (!allowed) {
        res.status(403).json({ status: 'fail', message: "Permission denied" });
        return
    }
    try {
        // XXX: Do lots of validation.
        let [ok, message] = await PerRowAcessCheck.checkIfUserCanEditPerRowAccessConfig(request.dsName, request.dsView, request.dsUser, request.perRowAccessConfig);
        if (!ok) {
            res.status(403).json({ status: 'fail', message });
            return    
        }
        let dbAbstraction = new DbAbstraction();
        let dbResponse = await dbAbstraction.update(request.dsName, "metaData", { _id: `view_${request.dsView}` }, { columnAttrs: request.viewDefs } );
        if (request.jiraConfig) {
            dbResponse = await dbAbstraction.update(request.dsName, "metaData", { _id: "jiraConfig" }, { ...request.jiraConfig });
            logger.info({requestId: req.requestId, dbResponse}, "Add jiraConfig status");
        } else {
            dbResponse = await dbAbstraction.removeOneWithValidId(request.dsName, "metaData", { _id: "jiraConfig" });
            logger.info({requestId: req.requestId, dbResponse}, "Remove jiraConfig status");
        }
        if (request.jiraAgileConfig) {
            dbResponse = await dbAbstraction.update(request.dsName, "metaData", { _id: "jiraAgileConfig" }, { ...request.jiraAgileConfig });
            logger.info({requestId: req.requestId, dbResponse}, "Add jiraAgileConfig status");
        } else {
            dbResponse = await dbAbstraction.removeOneWithValidId(request.dsName, "metaData", { _id: "jiraAgileConfig" });
            logger.info({requestId: req.requestId, dbResponse}, "Remove jiraAgileConfig status");
        }
        dbResponse = await dbAbstraction.update(request.dsName, "metaData", { _id: "dsDescription" }, { ...request.dsDescription });
        logger.info({requestId: req.requestId, dbResponse}, "Update dsDescription status");
        if (request.otherTableAttrs && Object.keys(request.otherTableAttrs).length) {
            dbResponse = await dbAbstraction.update(request.dsName, "metaData", { _id: "otherTableAttrs" }, { ...request.otherTableAttrs });
            logger.info({requestId: req.requestId, dbResponse}, "Add otherTableAttrs status");
        }
        if (request.aclConfig) {
            let aclConfigUsers = "";
            if (typeof request.aclConfig.acl === "string") {
                // If there is no value in the aclConfig. we need to remove it.
                if (request.aclConfig.acl.length === 0) {
                    dbResponse = await dbAbstraction.removeOneWithValidId(request.dsName, "metaData", { _id: "aclConfig" });
                    logger.info({requestId: req.requestId, dbResponse}, "Remove aclConfig status");
                } else {
                    // If there is a value in the aclConfig. we need to add it to the array and update the metadata.
                    aclConfigUsers = request.aclConfig.acl;
                }
                request.aclConfig.acl = [];
            }
            let aclConfigUsersList = aclConfigUsers.split(",");
            for (let user of aclConfigUsersList) {
                user = user.trim();
                if (user.length === 0) {
                    continue;
                }
                if (!request.aclConfig.acl.includes(user)) {
                    logger.info({requestId: req.requestId}, `user is not present in aclConfig, adding: ${user}`);
                    request.aclConfig.acl.push(user);
                }
            }
            if (!request.aclConfig.acl.includes(request.dsUser)) {
                logger.info({requestId: req.requestId}, `dsUser is not present in aclConfig, adding: ${request.dsUser}`);
                request.aclConfig.acl.push(request.dsUser);
            }
            dbResponse = await dbAbstraction.update(request.dsName, "metaData", { _id: "aclConfig" }, { ...request.aclConfig });
            logger.info({requestId: req.requestId, dbResponse}, "Add aclConfig status");
        } else {
            dbResponse = await dbAbstraction.removeOneWithValidId(request.dsName, "metaData", { _id: "aclConfig" });
            logger.info({requestId: req.requestId, dbResponse}, "Remove aclConfig status");
        }
        if (request.perRowAccessConfig) {
            dbResponse = await dbAbstraction.update(request.dsName, "metaData", { _id: "perRowAccessConfig" }, { ...request.perRowAccessConfig });
            logger.info({requestId: req.requestId, dbResponse}, "Add perRowAccessConfig status");
        }
        if (request.jiraProjectName) {
            dbResponse = await dbAbstraction.update(request.dsName, "metaData", { _id: "jiraProjectName" }, { "jiraProjectName": request.jiraProjectName });
            logger.info({requestId: req.requestId, dbResponse}, "Add jiraProjectName status");
        } else {
            dbResponse = await dbAbstraction.removeOneWithValidId(request.dsName, "metaData", { _id: "jiraProjectName" });
            logger.info({requestId: req.requestId, dbResponse}, "Remove jiraProjectName status");
        }
        //let dbResponse = await dbAbstraction.removeOne(request.dsName, "data", request.selectorObj);
        //logger.info ('db update response: ', dbResponse);
        let response = {};
        response.status = 'success';
        response.message = 'ok';
        res.status(200).send(response);
    } catch (e) {
        logger.error({requestId: req.requestId, err: e}, "Exception in setViewDefinitions");
        res.status(415).send({status: 'fail', message: 'Server side exception'});
    }
});
  
router.post('/view/refreshJira', async (req, res, next) => {
    let request = req.body;
    logger.info({requestId: req.requestId, request}, "Incoming request in refreshJira");
    const token = req.cookies.jwt;
    let allowed = await AclCheck.aclCheck(request.dsName, request.dsView, request.dsUser, token);
    if (!allowed) {
        res.status(403).json({ "Error": "access_denied" });
        return
    }
    let deletedObj = {};
    let dbAbstraction = new DbAbstraction();
    try {
        // XXX: Do lots of validation.
        let jiraConfig = await dbAbstraction.find(request.dsName, "metaData", { _id: `jiraConfig` }, {});
        let jiraAgileConfig = await dbAbstraction.find(request.dsName, "metaData", { _id: `jiraAgileConfig` }, {});
        jiraConfig = jiraConfig[0]
        jiraAgileConfig = jiraAgileConfig[0]
        let response = {};
        if (jiraConfig && jiraConfig.jira && jiraConfig.jql) {
            //await Jira.refreshJiraQuery(request.dsName, "project = IQN AND status not in (Closed, Resolved) AND assignee in (membersOf(Digital_Control-Plane), membersOf(Digital-Platform)) ORDER BY Severity ASC, priority DESC");
            await Jira.refreshJiraQuery(request.dsName, jiraConfig);
            response.status = 'success'
        }
        if (jiraAgileConfig && jiraAgileConfig.jira) {
            await Jira.refreshJiraQuery(request.dsName, jiraAgileConfig);
            response.status = 'success'
        }
        if (!response.status) {
            logger.warn({requestId: req.requestId}, 'RefreshJira Failed');
            response.status = 'fail';
        }
        res.status(200).send(response);
    } catch (e) {
        logger.error({requestId: req.requestId, err: e}, "Exception in refereshJira");
        res.status(415).send(e);
    }
});

router.post('/view/addFilter', async (req, res, next) => {
    let request = req.body;
    logger.info({requestId: req.requestId, request}, "Incoming request in addFilter");
    const token = req.cookies.jwt;
    let allowed = await AclCheck.aclCheck(request.dsName, request.dsView, request.dsUser, token);
    if (!allowed) {
        res.status(403).json({ "Error": "access_denied" });
        return
    }
    let dbAbstraction = new DbAbstraction();
    try {
        // XXX: Do lots of validation.
        // First check if a filters doc is present. If not, add one. 
        let filters = await dbAbstraction.find(request.dsName, "metaData", { _id: `filters` }, {} );
        logger.info({requestId: req.requestId, filters}, "Filters in addFilter");
        if (!filters.length) {
            await dbAbstraction.update(request.dsName, "metaData", { _id: "filters" }, { _id: "filters" });
        }
        // Add the new filter here
        let selectorObj = {
            _id: 'filters'
        };
        selectorObj[request.filter.name] = null;
        let editObj = {};
        editObj[request.filter.name] = request.filter;
        logger.info({requestId: req.requestId, selectorObj}, 'SelectorObj in addFilter ');
        logger.info({requestId: req.requestId, editObj}, 'EditObj in addFilter ');
        let dbResponse = await dbAbstraction.updateOne(request.dsName, "metaData", selectorObj, editObj, false);
        logger.info({requestId: req.requestId, dbResponse}, 'Edit response in addFilter');
        let response = {};
        if (dbResponse.nModified == 1) {
            response.status = 'success';
        } else {
            response.status = 'fail';
        }
        filters = await dbAbstraction.find(request.dsName, "metaData", { _id: `filters` }, {} );
        logger.info({requestId: req.requestId, filters}, "Filters after adding filter");
        // XXX: If response fails, do a 'find' query and return the updated attribute.
        res.status(200).send(response);
    } catch (e) {
        logger.error({requestId: req.requestId, err: e}, "Exception in addFilter");
        res.status(415).send(e);
    }
});


router.post('/view/editFilter', async (req, res, next) => {
    let request = req.body;
    logger.info({requestId: req.requestId, request}, "Incoming request in editFilter");
    const token = req.cookies.jwt;
    let allowed = await AclCheck.aclCheck(request.dsName, request.dsView, request.dsUser, token);
    if (!allowed) {
        res.status(403).json({ "Error": "access_denied" });
        return
    }
    let dbAbstraction = new DbAbstraction();
    try {
        // XXX: Do lots of validation.
        // First check if a filters doc is present. If not, add one. 
        let filters = await dbAbstraction.find(request.dsName, "metaData", { _id: `filters` }, {} );
        logger.info({requestId: req.requestId, filters}, "Filters in editFilter");
        if (!filters.length) {
            await dbAbstraction.update(request.dsName, "metaData", { _id: "filters" }, { _id: "filters" });
        }
        // Add the new filter here
        let selectorObj = {
            _id: 'filters'
        };
        let editObj = {};
        editObj[request.filter.name] = request.filter;
        logger.info({requestId: req.requestId, selectorObj}, 'SelectorObj in editFilter');
        logger.info({requestId: req.requestId, editObj}, 'EditObj in editFilter');
        let dbResponse = await dbAbstraction.updateOne(request.dsName, "metaData", selectorObj, editObj, false);
        logger.info({requestId: req.requestId, dbResponse}, 'Edit response in editFilter');
        let response = {};
        if (dbResponse.nModified == 1) {
            response.status = 'success';
        } else {
            response.status = 'fail';
        }
        filters = await dbAbstraction.find(request.dsName, "metaData", { _id: `filters` }, {} );
        logger.info({requestId: req.requestId, filters}, "Filters after editing filter");
        // XXX: If response fails, do a 'find' query and return the updated attribute.
        res.status(200).send(response);
    } catch (e) {
        logger.error({requestId: req.requestId, err: e}, "Exception in editFilter");
        res.status(415).send(e);
    }
});

router.post('/view/deleteFilter', async (req, res, next) => {
    let request = req.body;
    logger.info({requestId: req.requestId, request}, "Incoming request in deleteFilter");
    const token = req.cookies.jwt;
    let allowed = await AclCheck.aclCheck(request.dsName, request.dsView, request.dsUser, token);
    if (!allowed) {
        res.status(403).json({ "Error": "access_denied" });
        return
    }
    let dbAbstraction = new DbAbstraction();
    try {
        // XXX: Do lots of validation.
        // First check if a filters doc is present. If not, add one. 
        let filters = await dbAbstraction.find(request.dsName, "metaData", { _id: `filters` }, {} );
        logger.info({requestId: req.requestId, filters}, "Filters in deleteFilter");
        if (!filters.length) {
            await dbAbstraction.update(request.dsName, "metaData", { _id: "filters" }, { _id: "filters" });
        }
        // delete the new filter here
        let selectorObj = {
            _id: 'filters'
        };
        let unsetObj = {};
        unsetObj[request.filter.name] = "";
        logger.info({requestId: req.requestId, selectorObj}, 'SelectorObj in deleteFilter');
        logger.info({requestId: req.requestId, unsetObj}, 'UnsetObj in deleteFilter');
        let dbResponse = await dbAbstraction.unsetOne(request.dsName, "metaData", selectorObj, unsetObj, false);
        logger.info({requestId: req.requestId, dbResponse}, 'Unset response in deleteFilter');
        let response = {};
        if (dbResponse.nModified == 1) {
            response.status = 'success';
        } else {
            response.status = 'fail';
        }
        filters = await dbAbstraction.find(request.dsName, "metaData", { _id: `filters` }, {} );
        logger.info({requestId: req.requestId, filters}, "Filters after deleting filter");
        // XXX: If response fails, do a 'find' query and return the updated attribute.
        res.status(200).send(response);
    } catch (e) {
        logger.error({requestId: req.requestId, err: e}, "Exception in deleteFilter");
        res.status(415).send(e);
    }
});


// Dataset editing utilities triggered by bulk-editing. 


router.post('/doBulkEdit', async (req, res, next) => {
    let request = req.body;
    logger.info({requestId: req.requestId, request}, "Incoming request in doBulkEdit");
    const token = req.cookies.jwt;
    let allowed = await AclCheck.aclCheck(request.dsName, request.dsView, request.dsUser, token);
    if (!allowed) {
        logger.warn({requestId: req.requestId}, `${request.dsUser} doesn't have access to do bulk edit`);
        res.status(403).json({ "Error": "access_denied" });
        return
    }
    let dbAbstraction = new DbAbstraction();
    try {
        let excelUtils = await ExcelUtils.getExcelUtilsForFile("uploads/" + request.fileName);
        // @ts-ignore
        let loadStatus = await excelUtils.loadHdrsFromRange(request.sheetName, request.selectedRange);
        if (!loadStatus.loadStatus) {
            res.status(200).send(loadStatus);
            return;    
        }
        let keys = await dbAbstraction.find(request.dsName, "metaData", { _id: `keys` }, {} );
        keys = keys[0].keys;
        let viewDefault = await dbAbstraction.find(request.dsName, "metaData", { _id: `view_default` }, {} );
        let curCols = viewDefault[0].columns;
        let curColsInRev = {};
        Object.entries(curCols).map((kv) => {
            curColsInRev[kv[1]] = kv[0];
        })
        logger.info({requestId: req.requestId}, "Came here #1");
        /*
            keys are:  [ 'Work-id' ]
            loadStatus.hdrs are:  {
            '1': 'Work-id',
            '2': 'Description',
            '3': 'Priority',
            '4': 'Target',
            '5': 'Owner',
            '6': 'Status',
            '7': 'Comments'
            }
        */
        let colsInSheetInRev = {};
        // @ts-ignore
        Object.entries(loadStatus.hdrs).map((kv) => {
            colsInSheetInRev[kv[1]] = kv[0];
        })

        // Make sure all keys are present in the sheet. loadStatus.hdrs
        for (let i = 0; i < keys.length; i++) {
            let key = keys[i];
            if (!colsInSheetInRev[key]) {
                loadStatus.loadStatus = false;
                loadStatus.error = `key: ${key} is not present in edit sheet`;
                logger.warn({requestId: req.requestId}, `Bulk edit error: ${loadStatus.error}`);
                res.status(200).send(loadStatus);
                return;
            }
        }

        let oprLog = [];
        // Find out new columns
        let newCols = {};
        let colsInSheet = Object.keys(colsInSheetInRev);
        for (let i = 0; i < colsInSheet.length; i++) {
            let col = colsInSheet[i];
            if (!curColsInRev[col]) {
                newCols[col] = 1;
            }
        }
        // Find out deleted columns 
        let delCols = {};
        if (request.setColsFrmSheet) {
            let curCols = Object.keys(curColsInRev);
            for (let i = 0; i < curCols.length; i++) {
                let col = curCols[i];
                if (!colsInSheetInRev[col]) {
                    delCols[col] = 1;
                }
            }
        }
        // Add the new columns now. First 'column' and 'columnAttrs' needs updating.
        {
            let viewDefault = await dbAbstraction.find(request.dsName, "metaData", { _id: `view_default` }, {} );
            let columns = viewDefault[0].columns;
            let columnAttrs = viewDefault[0].columnAttrs;
            let newColKeys = Object.keys(newCols);
            let j = Object.keys(columns).length + 1;
            for (let i = 0; i < newColKeys.length; i++) {
                let newCol = newColKeys[i];
                columns[j] = newCol;
                j++;
                columnAttrs.push({
                    field: newCol,
                    title: newCol,
                    width: 150,
                    editor: "textarea",
                    editorParams: {},
                    formatter: "textarea",
                    headerFilterType: "input",
                    hozAlign: "center",
                    vertAlign: "middle",
                    headerTooltip: true    
                })
            }
            if (newColKeys.length) oprLog.push(`Adding new columns: ${JSON.stringify(newColKeys)}`);
            if (request.doIt)
                await dbAbstraction.update(request.dsName, "metaData", { _id: `view_default` }, { columns, columnAttrs, userColumnAttrs: viewDefault[0].userColumnAttrs } );
        }
        logger.info({requestId: req.requestId}, "Came here #2");
        // Now add the new column to all filters
        {
            let filters = await dbAbstraction.find(request.dsName, "metaData", { _id: `filters` }, {} );
            filters = filters[0] || {};
            let filterKeys = Object.keys(filters);
            for (let i = 0; i < filterKeys.length; i++) {
                let filterKey = filterKeys[i];
                if (filterKey === "_id") continue;
                let filterObj = filters[filterKey];
                let newColKeys = Object.keys(newCols);
                for (let i = 0; i < newColKeys.length; i++) {
                    let newCol = newColKeys[i];
                    filterObj.filterColumnAttrs[newCol] = {hidden: true, width: 150};
                }
            }
            let selectorObj = {
                _id: 'filters'
            };
            if (request.doIt && filterKeys.length)
                await dbAbstraction.updateOne(request.dsName, "metaData", selectorObj, filters, false);                
        }
        logger.info({requestId: req.requestId}, "Came here #3");
        // Nothing more to be done for addition of new columns. Jira config doesn't
        // require any changes. 


        // Now for column deletion. Delete from columns and columnAttrs
        {
            let viewDefault = await dbAbstraction.find(request.dsName, "metaData", { _id: `view_default` }, {} );
            let columns = viewDefault[0].columns, newColumns = {};
            let columnAttrs = viewDefault[0].columnAttrs, newColumnAttrs = [];
            let j = 1;
            /*
                columns can be like this. Note that it doesn't start with '1'. 
                This can happen when the table in xlsx is not in column 1. The names are 
                what is important. newColumns will ensure that it starts with '1'. 
                    {
                    '2': 'Testcase_No',
                    '3': 'Test case',
                    }
            */
            let columnsKeys = Object.keys(columns);
            for (let i = 0; i < columnsKeys.length; i++) {
                if (columns[columnsKeys[i]] in delCols) continue;
                newColumns[j] = columns[columnsKeys[i]]; j++;
                // Explicitly make sure newColumnAttrs match the newColumns. 
                // (helps in repairing any bugs here)
                let found = false;
                for (let k = 0; k < columnAttrs.length; k++) {
                    if (columnAttrs[k].field !== columns[columnsKeys[i]]) continue;
                    newColumnAttrs.push(columnAttrs[k]); found = true;
                    break;
                }
                if (!found) {
                    newColumnAttrs.push({                    
                        field: columns[columnsKeys[i]],
                        title: columns[columnsKeys[i]],
                        width: 150,
                        editor: "textarea",
                        editorParams: {},
                        formatter: "textarea",
                        headerFilterType: "input",
                        hozAlign: "center",
                        vertAlign: "middle",
                        headerTooltip: true    
                    })
                }
            }

            let curColsInRev = {};
            Object.entries(columns).map((kv) => {
                curColsInRev[kv[1]] = kv[0];
            })

            let delColKeys = Object.keys(delCols);
            if (delColKeys.length) oprLog.push(`Deleting columns: ${JSON.stringify(delColKeys)}`);
            logger.info({requestId: req.requestId, newColumns}, "New columns");
            if (request.doIt)
                await dbAbstraction.update(request.dsName, "metaData", { _id: `view_default` }, { columns: newColumns, columnAttrs: newColumnAttrs, userColumnAttrs: viewDefault[0].userColumnAttrs } );
        }
        logger.info({requestId: req.requestId}, "Came here #4");

        // Now scrub from all the filters... 
        {
            let filters = await dbAbstraction.find(request.dsName, "metaData", { _id: `filters` }, {} );
            filters = filters[0] || {};
            function cleansedHdrFilters (delCol, filterObj, filterKey) {
                let newHdrFilters = [];
                for (let i = 0; i < filterObj.hdrFilters.length; i++) {
                    if (filterObj.hdrFilters[i].field === delCol) {
                        oprLog.push(`Dropped "${delCol}" from "${filterKey}" regex`);
                        continue;
                    }
                    newHdrFilters.push(filterObj.hdrFilters[i]);
                }
                return newHdrFilters;
            }
            function cleansedHdrSorters (delCol, filterObj, filterKey) {
                let newHdrSorters = [];
                for (let i = 0; i < filterObj.hdrSorters.length; i++) {
                    if (filterObj.hdrSorters[i].column === delCol) {
                        oprLog.push(`Dropped "${delCol}" from "${filterKey}" sorting`);
                        continue;
                    }
                    newHdrSorters.push(filterObj.hdrSorters[i]);
                }
                return newHdrSorters;
            }
            let filterKeys = Object.keys(filters);
            for (let i = 0; i < filterKeys.length; i++) {
                let filterKey = filterKeys[i];
                if (filterKey === "_id") continue;
                let filterObj = filters[filterKey];
                let delColKeys = Object.keys(delCols);
                for (let i = 0; i < delColKeys.length; i++) {
                    let delCol = delColKeys[i];
                    delete filterObj.filterColumnAttrs[delCol];
                    filterObj.hdrFilters = cleansedHdrFilters(delCol, filterObj, filterKey);
                    filterObj.hdrSorters = cleansedHdrSorters(delCol, filterObj, filterKey);
                }
            }
            let selectorObj = {
                _id: 'filters'
            };
            if (request.doIt && filterKeys.length)
                await dbAbstraction.updateOne(request.dsName, "metaData", selectorObj, filters, false);
        }
        logger.info({requestId: req.requestId}, "Came here #5");

        // Scrub jiraConfig now. 
        {
            let jiraConfig = await dbAbstraction.find(request.dsName, "metaData", { _id: `jiraConfig` }, {} );
            jiraConfig = jiraConfig[0]
            let delColKeys = Object.keys(delCols);
            if (jiraConfig && delColKeys) {
                for (let i = 0; i < delColKeys.length; i++) {
                    let delCol = delColKeys[i];
                    // key in jiraFieldMapping is the jira key. value is the
                    // column name.
                    let jiraKeys = Object.keys(jiraConfig.jiraFieldMapping);
                    for (let j = 0; j < jiraKeys.length; j++) {
                        let jk = jiraKeys[j];
                        if (jiraConfig.jiraFieldMapping[jk] === delCol) {
                            oprLog.push(`Dropped "${delCol}" from jira-mapping for jira-key: "${jk}"`);
                            delete jiraConfig.jiraFieldMapping[jk];
                        }
                    }
                }
                if (request.doIt)
                    await dbAbstraction.update(request.dsName, "metaData", { _id: "jiraConfig" }, jiraConfig);
            }
        }
        logger.info({requestId: req.requestId}, "Came here #6");

        // Finally, scrub the data documents and rid them of all the deleted columns        
        {
            let delColKeys = Object.keys(delCols);
            for (let i = 0; i < delColKeys.length; i++) {
                let delCol = delColKeys[i];
                if (request.doIt)
                    await dbAbstraction.removeFieldFromAll(request.dsName, "data", delCol);
            }
        }
        logger.info({requestId: req.requestId}, "Came here #7");

        // Delete all rows if asked.
        {
            if (request.setRowsFrmSheet) {
                oprLog.push(`Will purge existing rows first`);
                if (request.doIt)
                    await dbAbstraction.removeMany(request.dsName, "data", {});
            }
        }
        logger.info({requestId: req.requestId}, "Came here #8");

        // Finally update the rows as in the sheet. 
        {
            oprLog.push(`Will update rows specified in sheet`);
            if (request.doIt)
                // @ts-ignore
                loadStatus = await excelUtils.bulkUpdateDataIntoDb(request.sheetName, request.selectedRange, loadStatus.hdrs, keys, request.dsName, request.dsUser)
        }
        logger.info({requestId: req.requestId}, "Came here #9");

        loadStatus.oprLog = oprLog;
        res.status(200).send(loadStatus);
    } catch (e) {
        logger.error({requestId: req.requestId, err: e}, "Exception in bulkEdit");
        res.status(415).send(e);
    }
});

router.post('/createDsFromDs', async (req, res, next) => {
    let request = req.body;
    logger.info({requestId: req.requestId, request}, "Incoming request in createDsFromDs");
    const token = req.cookies.jwt;
    let allowed = await AclCheck.aclCheck(request.fromDsName, "", request.dsUser, token);
    if (!allowed) {
        res.status(403).json({ status: 'fail', message: "Permission denied" });
        return
    }
    let [ok, message] = await PerRowAcessCheck.checkIfUserCanCopyDs(request.fromDsName, request.dsUser);
    if (!ok) {
        res.status(403).json({ status: 'fail', message });
        return
    }
    let dbAbstraction = new DbAbstraction();
    try {
        // XXX: Do lots of validation.
        // Check for existing db!
        let dbList = await dbAbstraction.listDatabases();
        for (let i = 0; i < dbList.length; i++) {
            if (dbList[i].name === request.toDsName) {
                logger.warn({requestId: req.requestId}, 'createDsFromDs: Dataset name conflict');
                res.status(415).send({ status: 'fail', message: 'Dataset name conflict' });
                return;
            }
        }

        let dbResponse = await dbAbstraction.copy(request.fromDsName, "metaData", request.toDsName, "metaData");
        if (request.retainData) {
            dbResponse = await dbAbstraction.copy(request.fromDsName, "data", request.toDsName, "data", (doc) => {
                let r = new RegExp(`/attachments/${request.fromDsName}/`, 'g');
                let t = `/attachments/${request.toDsName}/`;
                doc = JSON.stringify(doc).replace(r, t);
                doc = JSON.parse(doc);
                doc._id = new ObjectId(doc._id);
                return doc;
            });
            dbResponse = await dbAbstraction.copy(request.fromDsName, "editlog", request.toDsName, "editlog", (doc) => {
                let r = new RegExp(`/attachments/${request.fromDsName}/`, 'g');
                let t = `/attachments/${request.toDsName}/`;
                doc = JSON.stringify(doc).replace(r, t);
                doc = JSON.parse(doc);
                doc._id = new ObjectId(doc._id);
                return doc;
            });
            // copy the attachments directory, generate attachments table-cache. 
            Utils.copyRecursiveSync(`attachments/${request.fromDsName}`, `attachments/${request.toDsName}`)
            await PrepAttachments.refreshAttachmentsIntoDbForOne(request.toDsName);
        }
        // Change owner to current user...
        await dbAbstraction.update(request.toDsName, "metaData", { _id: "perms" }, { owner: request.dsUser });
        let aclConfig = await dbAbstraction.find(request.toDsName, "metaData", { _id: `aclConfig` }, {} );
        aclConfig = aclConfig[0];
        if (aclConfig && !aclConfig.acl.includes(request.dsUser)) {
            aclConfig.acl.push(request.dsUser);
            dbResponse = await dbAbstraction.update(request.toDsName, "metaData", { _id: "aclConfig" }, { ...aclConfig });
        }

        res.status(200).send({ status: 'success', message: 'ok' });
    } catch (e) {
        logger.error({requestId: req.requestId, err: e}, "Exception in createDsFromDs");
        res.status(415).send({ status: 'fail', message: 'Server side exception' });
    }
});


// router.post('/createJiraIssue', async (req, res, next) => {
//     let request = req.body
//     logger.info('Create jira issue request:', req.body)
//     let allowed = await AclCheck.aclCheck(request.dsName, request.dsView, request.dsUser);
//     if (!allowed) {
//         res.status(415).json({});
//         return
//     }
//     //TODO: call Jira.js function
//     Jira.createJiraIssue(request)
// })

router.post('/getProjectsMetadata', async (req, res, next) => {
    let request = req.body
    logger.info({requestId: req.requestId, request}, 'Incoming request in getProjectsMetadata')
    const token = req.cookies.jwt;
    let allowed = await AclCheck.aclCheck(request.dsName, request.dsView, request.dsUser, token);
    if (!allowed) {
        res.status(403).json({ "Error": "access_denied" });
        return
    }
    let response = await Jira.getProjectsMetaData(request.dsName, request.jiraConfig, request.jiraAgileConfig)
    if (response && Object.keys(response).length != 0) {
        res.status(200).json(response)
    } else {
        res.status(415).json({})
    }
})

router.post('/getProjectsMetaDataForProject', async (req, res, next) => {
    let request = req.body
    logger.info({requestId: req.requestId, request}, 'Incoming request in getProjectsMetaDataForProject')
    const token = req.cookies.jwt;
    let allowed = await AclCheck.aclCheck(request.dsName, request.dsView, request.dsUser, token);
    if (!allowed) {
        res.status(403).json({ "Error": "access_denied" });
        return
    }
    if (!request.jiraProjectName) {
        logger.warn({requestId: req.requestId}, "Expected jiraProjectName in the call to getProjectsMetaDataForProject not found");
        res.status(415).json({})
        return;
    }
    let response = await Jira.getProjectsMetaDataForProject(request.dsName, request.jiraConfig, request.jiraAgileConfig, request.jiraProjectName)
    if (response && Object.keys(response).length != 0) {
        res.status(200).json(response)
    } else {
        res.status(415).json({})
    }
})

router.post('/getDefaultTypeFieldsAndValues', async (req, res, next) => {
    let request = req.body
    logger.info({requestId: req.requestId, request}, 'Incoming request in getDefaultTypeFieldsAndValues');
    const token = req.cookies.jwt;
    let allowed = await AclCheck.aclCheck(request.dsName, request.dsView, request.dsUser, token);
    if (!allowed) {
        res.status(403).json({ "Error": "access_denied" });
        return
    }
    let response = Jira.getDefaultTypeFieldsAndValues()
    if (response && Object.keys(response).length != 0) {
        res.status(200).json(response)
    } else {
        res.status(415).json({})
    }
})

router.post('/getDefaultTypeFieldsAndValuesForProject', async (req, res, next) => {
    let request = req.body
    logger.info({requestId: req.requestId, request}, 'Incoming request in getDefaultTypeFieldsAndValuesForProject');
    const token = req.cookies.jwt;
    let allowed = await AclCheck.aclCheck(request.dsName, request.dsView, request.dsUser, token);
    if (!allowed) {
        res.status(403).json({ "Error": "access_denied" });
        return
    }
    if (!request.jiraProjectName) {
        logger.warn({requestId: req.requestId}, "Expected jiraProjectName in the call to getProjectsMetaDataForProject not found");
        res.status(415).json({})
        return;
    }
    let response = Jira.getDefaultTypeFieldsAndValuesForProject(request.jiraProjectName);
    if (response && Object.keys(response).length != 0) {
        res.status(200).json(response)
    } else {
        res.status(415).json({})
    }
})

router.post('/view/convertToJira', async (req, res, next) => {
    let request = req.body;
    logger.info({requestId: req.requestId, request}, "Incoming request in convertToJira");
    const token = req.cookies.jwt;
    let allowed = await AclCheck.aclCheck(request.dsName, request.dsView, request.dsUser, token);
    if (!allowed) {
        res.status(403).json({ "Error": "access_denied" });
        return
    }
    let dbAbstraction = new DbAbstraction();
    try {
        let response = {}
        // Call jira function with the incoming data and update the jira.
        let jiraFormData = request.jiraFormData
        Utils.sanitizeData(jiraFormData)
        let jiraResponse = await Jira.createJiraIssue(jiraFormData)
        if (jiraResponse.status == 'fail') {
            response.status = jiraResponse.status
            response.error = jiraResponse.error
            res.status(200).send(response);
            return
        }
        // Once the response comes back make the mongodb data according to the mapping and update mongodb
        let jiraRec = await Jira.getJiraRecordFromKey(jiraResponse.key)
        if (Object.keys(jiraRec).length == 0) {
            response.status = 'fail'
            response.error = 'unable to retrieve jira issue after update. Please refresh table and refresh JIRA'
            res.status(200).send(response);
            return
        }
        let selectorObj = {};
        selectorObj["_id"] = dbAbstraction.getObjectId(request.selectorObj._id);
        let updateResponse = null
        if (jiraFormData.Type == "Bug") {
            updateResponse = await Jira.updateJiraRecInDb(request.dsName, selectorObj, jiraRec, request.jiraConfig)
        } else {
            updateResponse = await Jira.updateJiraRecInDb(request.dsName, selectorObj, jiraRec, request.jiraAgileConfig)
        }
        // In response, send the updated columns and their value and the status.
        if (updateResponse.status == 'success') {
            response.status = updateResponse.status;
            response.record = updateResponse.record;
            response.key = jiraResponse.key;
        } else {
            response.status = updateResponse.status;
            response.error = updateResponse.error;
        }
        res.status(200).send(response)
        return
    } catch (e) {
        logger.error({requestId: req.requestId, err: e}, "Exception in convertToJira");
        res.status(415).send(e);
    }
});

router.post('/view/addJiraRow', async (req, res, next) => {
    let request = req.body;
    logger.info({requestId: req.requestId, request}, "Incoming request in addJiraRow");
    const token = req.cookies.jwt;
    let allowed = await AclCheck.aclCheck(request.dsName, request.dsView, request.dsUser, token);
    if (!allowed) {
        res.status(403).json({ "Error": "access_denied" });
        return
    }
    let dbAbstraction = new DbAbstraction();
    try {
        let response = {}
        if (request.parentKey) {
            let parentJiraRec = await Jira.getJiraRecordFromKey(request.parentKey)
            if (Object.keys(parentJiraRec).length == 0) {
                response.status = 'fail'
                response.error = 'unable to retrieve parent Jira. Please refresh jira.'
                res.status(200).send(response);
                return
            }
        }
        // Call jira function with the incoming data and update the jira.
        let jiraFormData = request.jiraFormData
        Utils.sanitizeData(jiraFormData)
        let jiraResponse = await Jira.createJiraIssue(jiraFormData)
        if (jiraResponse.status == 'fail') {
            response.status = jiraResponse.status
            response.error = jiraResponse.error
            res.status(200).send(response);
            return
        }
        // Once the response comes back make the mongodb data according to the mapping and update mongodb
        let jiraRec = await Jira.getJiraRecordFromKey(jiraResponse.key)
        if (Object.keys(jiraRec).length == 0) {
            response.status = 'fail'
            response.error = 'unable to retrieve jira issue after update. Please refresh table and refresh JIRA'
            res.status(200).send(response);
            return
        }
        let fullRec, selectorObj;
        if (jiraFormData.Type == "Bug") {
            let r = Jira.getFullRecFromJiraRec(jiraRec, request.jiraConfig)
            fullRec = r.fullRec
            selectorObj = r.selectorObj
        } else {
            let r = Jira.getFullRecFromJiraRec(jiraRec, request.jiraAgileConfig)
            fullRec = r.fullRec
            selectorObj = r.selectorObj
        }
        let dbAbstraction = new DbAbstraction();
        let dbResponse = await dbAbstraction.insertOneUniquely(request.dsName, "data", selectorObj, fullRec);
        logger.info({requestId: req.requestId, dbResponse}, 'insertOneUniquely db response in addJiraRow');
        if (dbResponse.ok == 1 && dbResponse.upserted && dbResponse.upserted.length == 1) {
            response.status = 'success';
            response._id = dbResponse.upserted[0]._id;
            response.record = fullRec
            response.key = jiraResponse.key
        } else {
            response.status = 'fail';
            response.error = 'unable to update the db with new issue. Please refresh jira.'
        }
        if (request.parentKey) {
            let parentJiraRec = await Jira.getJiraRecordFromKey(request.parentKey)
            let parentSelectorObj = {};
            parentSelectorObj["_id"] = dbAbstraction.getObjectId(request.parentSelectorObj._id);
            let parentUpdateResponse = await Jira.updateJiraRecInDb(request.dsName, parentSelectorObj, parentJiraRec, request.jiraAgileConfig)
            if (parentUpdateResponse.status == 'success') {
                response.parentRecord = parentUpdateResponse.record;
            }
        }
        res.status(200).send(response)
        return
    } catch (e) {
        logger.error({requestId: req.requestId, err: e}, "Exception in addJiraRow");
        res.status(415).send(e);
    }
});

module.exports = router;
