const router = require('express').Router();
const DbAbstraction = require('../dbAbstraction');
const ExcelUtils = require('../excelUtils');
const FS = require('fs');
const Jira = require('../jira');

router.get('/view/columns/:dsName/:dsView/:dsUser', async (req, res, next) => {
    let request = req.body;
    console.log("In columns: ", req.params);
    console.log("In columns: ", req.query);

    // XXX: Do lots of validation.
    let dbAbstraction = new DbAbstraction();
    let response = await dbAbstraction.find(req.params.dsName, "metaData", { _id: `view_${req.params.dsView}` }, {} );
    console.log(response[0].columns);
    let keys = await dbAbstraction.find(req.params.dsName, "metaData", { _id: `keys` }, {} );
    console.log(keys[0]);
    let jiraConfig = await dbAbstraction.find(req.params.dsName, "metaData", { _id: `jiraConfig` }, {} );
    jiraConfig = jiraConfig[0]
    let dsDescription = await dbAbstraction.find(req.params.dsName, "metaData", { _id: `dsDescription` }, {} );
    dsDescription = dsDescription[0]
    let otherTableAttrs = await dbAbstraction.find(req.params.dsName, "metaData", { _id: `otherTableAttrs` }, {} );
    if (otherTableAttrs.length)
        otherTableAttrs = otherTableAttrs[0];
    let filters = await dbAbstraction.find(req.params.dsName, "metaData", { _id: `filters` }, {} );
    console.log("Filters: ", filters);
    filters = filters[0]
    try {
        if (Object.keys(response[0].columnAttrs).length == 0 || response[0].columnAttrs.length == 0) {
            // Do something here and set the columnAttrs?
        }
    } catch (e) {};
    res.status(200).json({ columns: response[0].columns, columnAttrs: response[0].columnAttrs, keys: keys[0].keys, jiraConfig, dsDescription, filters, otherTableAttrs });
    return;
});

async function pager (req, res, collectionName) {
    let request = req.body;
    console.log("In pager: ", req.params);
    console.log("In pager: ", req.query);
    console.log("In pager, collectionName:", collectionName)
    let filters = {}; sorters = [];
    try {
        req.query.filters.map((v) => {
            if (v.type === 'like') {
                let regex = v.value, negate = false;
                let m = regex.match(/^\s*!(.*)$/);
                if (m && m.length >= 1) {
                    negate = true;
                    regex = m[1];
                }
                if (negate) {
                    filters[v.field] = { $not: {$regex: `${regex}`, $options: 'i'} };
                } else {
                    filters[v.field] = {$regex: `${regex}`, $options: 'i'};
                }
            } else if (v.type === '=') {
                let numVal = Number(v.value);
                filters[v.field] = {$eq: numVal};
            }
            /*
            if (v.value !== '' && !Number.isNaN(Number(v.value))) {
                let numVal = Number(v.value);
                filters[v.field] = {$eq: numVal};
            }*/
        })
    } catch (e) {}
    try {
        req.query.sorters.map((v) => {
            let f = [];
            f.push(v.field); f.push(v.dir);
            sorters.push(f);
        })
    } catch (e) {}
    // Add a default sorter
    if (!sorters.length) {
        let f = []
        f.push('_id'); 
        if (req.query.chronology)
            f.push(req.query.chronology);
        else 
            f.push('desc');
        sorters.push(f);
    }
    // XXX: Do lots of validation.
    console.log("mongo filters: ", filters);
    console.log("mongo sorters: ", sorters)
    let options = {};
    if (sorters.length)
        options.sort = sorters;
    let dbAbstraction = new DbAbstraction();
    let response = {};
    try {
        response = await dbAbstraction.pagedFind(req.params.dsName, collectionName, filters, options, parseInt(req.query.page), parseInt(req.query.per_page) );
    } catch (e) {}
    res.status(200).json(response);
}

router.get('/view/:dsName', async (req, res, next) => {
    await pager(req, res, "data");
});

router.get('/view/editLog/:dsName', async (req, res, next) => {
    await pager(req, res, "editlog");
});

router.get('/view/attachments/:dsName', async (req, res, next) => {
    await pager(req, res, "attachments");
});

function getSingleEditLog (req, isKey, status) {
    let selectorObj = JSON.parse(JSON.stringify(req.selectorObj));
    let editObj = JSON.parse(JSON.stringify(req.editObj));
    //column, oldVal, newVal, user, selector, date
    let editDoc = {};
    editDoc.opr = "edit";
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
    console.log("In editSingleAttribute: ", request);
    try {
        // XXX: Do lots of validation.
        let dbAbstraction = new DbAbstraction();
        let keys = await dbAbstraction.find(request.dsName, "metaData", { _id: `keys` }, {} );
        console.log(keys[0]);
        let keyBeingEdited = false;
        let editObjKeys = Object.keys(request.editObj)
        for (let i = 0; i < editObjKeys.length; i++) {
            key = editObjKeys[i];
            for (let j = 0; j < keys[0].keys.length; j++) {
                if (keys[0].keys[j] === key) {
                    keyBeingEdited = true;
                    break;
                }
            }
        }
        let response = {};
        if (keyBeingEdited) {
            console.log("A key is being edited: Do in transaction");
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
            console.log ('Edit response: ', dbResponse);
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
        console.log('editLog (edit) response: ', editLogResp);
        // XXX: If response fails, do a 'find' query and return the updated attribute.
        res.status(200).send(response);
    } catch (e) {
        console.log("Got exception: ", e);
        res.status(415).send(e);
    }
});


router.post('/view/insertOneDoc', async (req, res, next) => {
    let request = req.body;
    console.log("In insertOneDoc: ", request);
    try {
        // XXX: Do lots of validation.
        let dbAbstraction = new DbAbstraction();
        let dbResponse = await dbAbstraction.insertOneUniquely(request.dsName, "data", request.selectorObj, request.doc);
        console.log ('insertOneUniquely response: ', dbResponse);
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
        console.log('editLog (insert) response: ', editLogResp);
        // XXX: If response fails, do a 'find' query and return the updated attribute.
        res.status(200).send(response);
    } catch (e) {
        console.log("Got exception: ", e);
        res.status(415).send(e);
    }
});


router.post('/view/insertOrUpdateOneDoc', async (req, res, next) => {
    let request = req.body;
    console.log("In insertOrUpdateOneDoc: ", request);
    //res.status(200).send({status: 'success'});
    //return;
    try {
        // XXX: Do lots of validation.
        let dbAbstraction = new DbAbstraction();
        let dbResponse = await dbAbstraction.update(request.dsName, "data", request.selectorObj, request.doc);
        console.log ('insertOrUpdateOneDoc response: ', dbResponse);
        let response = {};
        if (dbResponse.result.ok == 1) {
            response.status = 'success';
            if (dbResponse.upserted)
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
        //let editLog = getInsertLog(request, response.status);
        //let editLogResp = await dbAbstraction.insertOne(request.dsName, "editlog", editLog);
        //console.log('editLog (insert) response: ', editLogResp);
        // XXX: If response fails, do a 'find' query and return the updated attribute.
        res.status(200).send(response);
    } catch (e) {
        console.log("Got exception: ", e);
        res.status(415).send(e);
    }
});


router.get('/downloadXlsx/:dsName/:dsView/:dsUser', async (req, res, next) => {
    let request = req.body;
    console.log("In downloadXlsx: ", req.params);
    console.log("In downloadXlsx: ", req.query);

    let fileName = `export_${req.params.dsName}_${req.params.dsView}_${req.params.dsUser}.xlsx`
    await ExcelUtils.exportDataFromDbIntoXlsx(req.params.dsName, req.params.dsView, req.params.dsUser, fileName);
    try {
        let bits = FS.readFileSync(fileName);
        // convert binary data to base64 encoded string
        let base64Str = new Buffer(bits).toString('base64');
        res.json({output: base64Str});
        FS.unlinkSync(fileName);
    } catch (e) {
        console.log("downloadXlsx exception: ", e)
    }
});


router.get('/dsList/:dsUser', async (req, res, next) => {
    let request = req.body;
    console.log("In dsList: ", req.params);
    console.log("In dsList: ", req.query);

    let dbAbstraction = new DbAbstraction();
    let dbList = await dbAbstraction.listDatabases();
    let pruned = [];
    let sysDbs = ['admin', 'config', 'local'];
    for (let i = 0; i < dbList.length; i++) {
        let j = sysDbs.indexOf(dbList[i].name);
        if (j > -1)
            continue;
        pruned.push(dbList[i]);
    }
    for (let i = 0; i < pruned.length; i++) {
        let perms = await dbAbstraction.find(pruned[i].name, 'metaData', { _id: "perms" });
        pruned[i].perms = perms[0];
    }
    console.log("Returning: ", pruned);
    res.json({ dbList: pruned });
});

router.post('/deleteDs', async (req, res, next) => {
    let request = req.body;
    console.log("In deleteDs: ", request);
    try {
        // XXX: Do lots of validation.
        let dbAbstraction = new DbAbstraction();
        let dbResponse = await dbAbstraction.deleteDb(request.dsName);
        console.log ('DeleteDs response: ', dbResponse);
        let response = {};
        response.status = 'success';
        res.status(200).send(response);
    } catch (e) {
        console.log("Got exception: ", e);
        res.status(415).send(e);
    }
});

router.post('/view/deleteOneDoc', async (req, res, next) => {
    let request = req.body;
    console.log("In deleteOneDoc: ", request);
    let deletedObj = {};
    try {
        // XXX: Do lots of validation.
        let dbAbstraction = new DbAbstraction();
        // First get a copy of the object we are deleting. 
        if (request.selectorObj._id) {
            let _id = dbAbstraction.getObjectId(request.selectorObj._id);
            let recs = await dbAbstraction.find(request.dsName, "data", { _id }, { });
            deletedObj = recs[0];
            console.log("Objecting getting deleted: ", deletedObj);
        }
        let dbResponse = await dbAbstraction.removeOne(request.dsName, "data", request.selectorObj);
        console.log ('deleteOne response: ', dbResponse);
        let response = {};
        response.status = 'success';

        let editLog = getDeleteLog(request, deletedObj, response.status);
        let editLogResp = await dbAbstraction.insertOne(request.dsName, "editlog", editLog);
        console.log('editLog (delete) response: ', editLogResp);
        // XXX: If response fails, do a 'find' query and return the updated attribute.
        res.status(200).send(response);
    } catch (e) {
        console.log("Got exception: ", e);
        res.status(415).send(e);
    }
});

router.post('/view/deleteManyDocs', async (req, res, next) => {
    let request = req.body;
    console.log("In deleteManyDocs: ", request);
    //res.status(200).send({status: 'success'});
    //return;
    let deletedObj = {};
    try {
        // XXX: Do lots of validation.
        let dbAbstraction = new DbAbstraction();
        for (let i = 0; i < request.objects.length; i++) {
            // First get a copy of the object we are deleting. 
            let _id = dbAbstraction.getObjectId(request.objects[i]);
            let recs = await dbAbstraction.find(request.dsName, "data", { _id }, { });
            deletedObj = recs[0];
            console.log("Objecting getting deleted: ", deletedObj);
            let dbResponse = await dbAbstraction.removeOne(request.dsName, "data", { _id : request.objects[i] });
            console.log (`deleteManyDocs response for ${request.objects[i]}: `, dbResponse);
            let editLog = getDeleteLog({ selectorObj: { _id: request.objects[i] } }, deletedObj, "success");
            let editLogResp = await dbAbstraction.insertOne(request.dsName, "editlog", editLog);
            console.log(`editLog (delete) response for ${request.objects[i]}: `, editLogResp);
        }

        let response = {};
        response.status = 'success';
        res.status(200).send(response);
    } catch (e) {
        console.log("Got exception: ", e);
        res.status(415).send(e);
    }
});


router.post('/view/setViewDefinitions', async (req, res, next) => {
    let request = req.body;
    console.log("In setViewDefinitions: ", request);
    try {
        // XXX: Do lots of validation.
        let dbAbstraction = new DbAbstraction();
        let dbResponse = await dbAbstraction.update(request.dsName, "metaData", { _id: `view_${request.dsView}` }, { columnAttrs: request.viewDefs } );
        if (request.jiraConfig) {
            dbResponse = await dbAbstraction.update(request.dsName, "metaData", { _id: "jiraConfig" }, { ...request.jiraConfig });
            console.log("Add jiraConfig status: ", dbResponse.result);
        } else {
            dbResponse = await dbAbstraction.removeOneWithValidId(request.dsName, "metaData", { _id: "jiraConfig" });
            console.log("Remove jiraConfig status: ", dbResponse);
        }
        dbResponse = await dbAbstraction.update(request.dsName, "metaData", { _id: "dsDescription" }, { ...request.dsDescription });
        console.log("Update dsDescription status: ", dbResponse.result);
        if (request.otherTableAttrs && Object.keys(request.otherTableAttrs).length) {
            dbResponse = await dbAbstraction.update(request.dsName, "metaData", { _id: "otherTableAttrs" }, { ...request.otherTableAttrs });
            console.log("Add otherTableAttrs status: ", dbResponse.result);
        }
        //let dbResponse = await dbAbstraction.removeOne(request.dsName, "data", request.selectorObj);
        //console.log ('db update response: ', dbResponse);
        let response = {};
        response.status = 'success';
        res.status(200).send(response);
    } catch (e) {
        console.log("Got exception: ", e);
        res.status(415).send(e);
    }
});
  
router.post('/view/refreshJira', async (req, res, next) => {
    let request = req.body;
    console.log("In refreshJira: ", request);
    let deletedObj = {};
    try {
        // XXX: Do lots of validation.
        let dbAbstraction = new DbAbstraction();
        let jiraConfig = await dbAbstraction.find(request.dsName, "metaData", { _id: `jiraConfig` }, {} );
        jiraConfig = jiraConfig[0]
        let response = {};
        if (jiraConfig.jira && jiraConfig.jql) {
            //await Jira.refreshJiraQuery(request.dsName, "project = IQN AND status not in (Closed, Resolved) AND assignee in (membersOf(Digital_Control-Plane), membersOf(Digital-Platform)) ORDER BY Severity ASC, priority DESC");
            await Jira.refreshJiraQuery(request.dsName, jiraConfig);
            response.status = 'success'
        } else {
            console.log('refreshJira Failed');
            response.status = 'fail';
        }
        res.status(200).send(response);
    } catch (e) {
        console.log("Got exception: ", e);
        res.status(415).send(e);
    }
});

router.post('/view/addFilter', async (req, res, next) => {
    let request = req.body;
    console.log("In addFilter: ", request);
    try {
        // XXX: Do lots of validation.
        // First check if a filters doc is present. If not, add one. 
        let dbAbstraction = new DbAbstraction();
        let filters = await dbAbstraction.find(request.dsName, "metaData", { _id: `filters` }, {} );
        console.log("Filters: ", filters);
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
        console.log('SelectorObj: ', JSON.stringify(selectorObj, null, 4));
        console.log('editObj: ', JSON.stringify(editObj, null, 4));
        let dbResponse = await dbAbstraction.updateOne(request.dsName, "metaData", selectorObj, editObj, false);
        console.log ('Edit response: ', dbResponse);
        let response = {};
        if (dbResponse.nModified == 1) {
            response.status = 'success';
        } else {
            response.status = 'fail';
        }
        filters = await dbAbstraction.find(request.dsName, "metaData", { _id: `filters` }, {} );
        console.log("Filters: ", filters);
        // XXX: If response fails, do a 'find' query and return the updated attribute.
        res.status(200).send(response);
    } catch (e) {
        console.log("Got exception: ", e);
        res.status(415).send(e);
    }
});


router.post('/view/editFilter', async (req, res, next) => {
    let request = req.body;
    console.log("In editFilter: ", request);
    try {
        // XXX: Do lots of validation.
        // First check if a filters doc is present. If not, add one. 
        let dbAbstraction = new DbAbstraction();
        let filters = await dbAbstraction.find(request.dsName, "metaData", { _id: `filters` }, {} );
        console.log("Filters: ", filters);
        if (!filters.length) {
            await dbAbstraction.update(request.dsName, "metaData", { _id: "filters" }, { _id: "filters" });
        }
        // Add the new filter here
        let selectorObj = {
            _id: 'filters'
        };
        let editObj = {};
        editObj[request.filter.name] = request.filter;
        console.log('SelectorObj: ', JSON.stringify(selectorObj, null, 4));
        console.log('editObj: ', JSON.stringify(editObj, null, 4));
        let dbResponse = await dbAbstraction.updateOne(request.dsName, "metaData", selectorObj, editObj, false);
        console.log ('Edit response: ', dbResponse);
        let response = {};
        if (dbResponse.nModified == 1) {
            response.status = 'success';
        } else {
            response.status = 'fail';
        }
        filters = await dbAbstraction.find(request.dsName, "metaData", { _id: `filters` }, {} );
        console.log("Filters: ", filters);
        // XXX: If response fails, do a 'find' query and return the updated attribute.
        res.status(200).send(response);
    } catch (e) {
        console.log("Got exception: ", e);
        res.status(415).send(e);
    }
});

router.post('/view/deleteFilter', async (req, res, next) => {
    let request = req.body;
    console.log("In deleteFilter: ", request);
    try {
        // XXX: Do lots of validation.
        // First check if a filters doc is present. If not, add one. 
        let dbAbstraction = new DbAbstraction();
        let filters = await dbAbstraction.find(request.dsName, "metaData", { _id: `filters` }, {} );
        console.log("Filters: ", filters);
        if (!filters.length) {
            await dbAbstraction.update(request.dsName, "metaData", { _id: "filters" }, { _id: "filters" });
        }
        // delete the new filter here
        let selectorObj = {
            _id: 'filters'
        };
        let unsetObj = {};
        unsetObj[request.filter.name] = "";
        console.log('SelectorObj: ', JSON.stringify(selectorObj, null, 4));
        console.log('unsetObj: ', JSON.stringify(unsetObj, null, 4));
        let dbResponse = await dbAbstraction.unsetOne(request.dsName, "metaData", selectorObj, unsetObj, false);
        console.log ('Unset response: ', dbResponse);
        let response = {};
        if (dbResponse.nModified == 1) {
            response.status = 'success';
        } else {
            response.status = 'fail';
        }
        filters = await dbAbstraction.find(request.dsName, "metaData", { _id: `filters` }, {} );
        console.log("Filters: ", filters);
        // XXX: If response fails, do a 'find' query and return the updated attribute.
        res.status(200).send(response);
    } catch (e) {
        console.log("Got exception: ", e);
        res.status(415).send(e);
    }
});


// Dataset editing utilities triggered by bulk-editing. 


router.post('/doBulkEdit', async (req, res, next) => {
    let request = req.body;
    console.log("In doBulkEdit: ", request);
    try {
        let excelUtils = await ExcelUtils.getExcelUtilsForFile("uploads/" + request.fileName);
        let loadStatus = await excelUtils.loadHdrsFromRange(request.sheetName, request.selectedRange);
        if (!loadStatus.loadStatus) {
            res.status(200).send(loadStatus);
            return;    
        }
        let dbAbstraction = new DbAbstraction();
        let keys = await dbAbstraction.find(request.dsName, "metaData", { _id: `keys` }, {} );
        keys = keys[0].keys;
        let viewDefault = await dbAbstraction.find(request.dsName, "metaData", { _id: `view_default` }, {} );
        let curCols = viewDefault[0].columns;
        let curColsInRev = {};
        Object.entries(curCols).map((kv) => {
            curColsInRev[kv[1]] = kv[0];
        })
        console.log("Came here #1");
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
        Object.entries(loadStatus.hdrs).map((kv) => {
            colsInSheetInRev[kv[1]] = kv[0];
        })

        // Make sure all keys are present in the sheet. loadStatus.hdrs
        for (let i = 0; i < keys.length; i++) {
            let key = keys[i];
            if (!colsInSheetInRev[key]) {
                loadStatus.loadStatus = false;
                loadStatus.error = `key: ${key} is not present in edit sheet`;
                console.log(`Bulk edit error: ${loadStatus.error}`);
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
        console.log("Came here #2");
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
        console.log("Came here #3");
        // Nothing more to be done for addition of new columns. Jira config doesn't
        // require any changes. 


        // Now for column deletion. Delete from columns and columnAttrs
        {
            let viewDefault = await dbAbstraction.find(request.dsName, "metaData", { _id: `view_default` }, {} );
            let columns = viewDefault[0].columns, newColumns = {};
            let columnAttrs = viewDefault[0].columnAttrs, newColumnAttrs = [];
            let j = 1;
            for (let i = 1; i <= Object.keys(columns).length; i++) {
                if (columns[i] in delCols) continue;
                newColumns[j] = columns[i]; j++;
                // Explicitly make sure newColumnAttrs match the newColumns. 
                // (helps in repairing any bugs here)
                let found = false;
                for (let k = 0; k < columnAttrs.length; k++) {
                    if (columnAttrs[k].field !== columns[i]) continue;
                    newColumnAttrs.push(columnAttrs[k]); found = true;
                    break;
                }
                if (!found) {
                    newColumnAttrs.push({                    
                        field: columns[i],
                        title: columns[i],
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

            if (request.doIt)
                await dbAbstraction.update(request.dsName, "metaData", { _id: `view_default` }, { columns: newColumns, columnAttrs: newColumnAttrs, userColumnAttrs: viewDefault[0].userColumnAttrs } );
        }
        console.log("Came here #4");

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
        console.log("Came here #5");

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
        console.log("Came here #6");

        // Finally, scrub the data documents and rid them of all the deleted columns        
        {
            let delColKeys = Object.keys(delCols);
            for (let i = 0; i < delColKeys.length; i++) {
                let delCol = delColKeys[i];
                if (request.doIt)
                    await dbAbstraction.removeFieldFromAll(request.dsName, "data", delCol);
            }
        }
        console.log("Came here #7");

        // Delete all rows if asked.
        {
            if (request.setRowsFrmSheet) {
                oprLog.push(`Will purge existing rows first`);
                if (request.doIt)
                    await dbAbstraction.removeMany(request.dsName, "data", {});
            }
        }
        console.log("Came here #8");

        // Finally update the rows as in the sheet. 
        {
            oprLog.push(`Will update rows specified in sheet`);
            if (request.doIt)
                loadStatus = await excelUtils.bulkUpdateDataIntoDb(request.sheetName, request.selectedRange, loadStatus.hdrs, keys, request.dsName, request.dsUser)
        }
        console.log("Came here #9");

        loadStatus.oprLog = oprLog;
        res.status(200).send(loadStatus);
    } catch (e) {
        console.log("Got exception: ", e);
        res.status(415).send(e);
    }
});



module.exports = router;