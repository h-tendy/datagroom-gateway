const router = require('express').Router();
const DbAbstraction = require('../dbAbstraction');
const ExcelUtils = require('../excelUtils');
const FS = require('fs');

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
    try {
        if (Object.keys(response[0].columnAttrs).length == 0 || response[0].columnAttrs.length == 0) {
            // Do something here and set the columnAttrs?
        }
    } catch (e) {};
    res.status(200).json({ columns: response[0].columns, columnAttrs: response[0].columnAttrs, keys: keys[0].keys });
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

router.post('/view/setViewDefinitions', async (req, res, next) => {
    let request = req.body;
    console.log("In setViewDefinitions: ", request);
    try {
        // XXX: Do lots of validation.
        let dbAbstraction = new DbAbstraction();
        let dbResponse = await dbAbstraction.update(request.dsName, "metaData", { _id: `view_${request.dsView}` }, { columnAttrs: request.viewDefs } );

        //let dbResponse = await dbAbstraction.removeOne(request.dsName, "data", request.selectorObj);
        console.log ('db update response: ', dbResponse);
        let response = {};
        response.status = 'success';
        res.status(200).send(response);
    } catch (e) {
        console.log("Got exception: ", e);
        res.status(415).send(e);
    }
});

module.exports = router;