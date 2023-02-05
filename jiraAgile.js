// @ts-check
var JiraApi = require('jira-client');
const { async } = require('regenerator-runtime');
const DbAbstraction = require('./dbAbstraction');
const JiraSettings = require('./jiraSettings');
// Initialize

let host = JiraSettings.host;
var jira = new JiraApi(JiraSettings.settings);

let fields = ["summary", "assignee", "customfield_25901", "issuetype", "customfield_26397", "customfield_11504", "description", "priority", "reporter", "customfield_21091", "status", "customfield_25792", "customfield_25907", "customfield_25802", "created", "customfield_22013", "customfield_25582", "customfield_25588", "customfield_25791", "versions", "parent", "subtasks", "issuelinks", "updated", "votes", "customfield_25570", "labels", "customfield_25693", "customfield_25518", "customfield_12790", "customfield_11890", "customfield_11990"];

let editableFields = ["description"]

async function editSingleAttribute(req) {
    let response = {}
    let request = req.body
    let jiraAgileConfig = request.jiraAgileConfig
    if (jiraAgileConfig && jiraAgileConfig.jira) {
        //TODO:
        // Check the mapping of the jira keys and validate the edit is supported for that field.
        // If not supported, return with error in response.
        let res = isFieldEditable(request.column, jiraAgileConfig)
        if (res.error) {
            response.status = res.status
            response.error = res.error
            return response
        }
        // Then call an api to write it to jira
        console.log("abc")
    }
    let dbResponse = await writeToDb(request)
    return response
}

function isFieldEditable(requestedColumn, jiraConfig) {
    let response = {}
    let jiraFieldMapping = jiraConfig.jiraFieldMapping
    let jiraUrl = "https://" + host;
    jiraFieldMapping = JSON.parse(JSON.stringify(jiraFieldMapping));
    let jiraKeyMapping = { 'key': jiraFieldMapping['key'] };
    delete jiraFieldMapping.key;
    let jiraContentMapping = jiraFieldMapping;
    let revContentMap = {};
    for (let key in jiraFieldMapping) {
        let dsField = jiraFieldMapping[key];
        if (!revContentMap[dsField])
            revContentMap[dsField] = 1;
        else
            revContentMap[dsField] = revContentMap[dsField] + 1;
    }
    if (!revContentMap[requestedColumn]) {
        response.status = 'fail'
        response.error = 'Column doesn\'t exist'
        return response
    }
    if (revContentMap[requestedColumn] == 1) {
        let jiraKey = getKeyByValue(jiraFieldMapping, requestedColumn)
        if (jiraKey) {
            if (editableFields.includes(jiraKey)) {
                response.status = 'pass'
            } else {
                response.status = 'fail'
                response.error = 'Field is not editable'
            }
        } else {
            response.status = 'fail'
            response.error = 'Field is not present'
        }
        return response
    }
    return response
}

async function writeToJira(request) {

}

async function writeToDb(request) {
    let dbAbstraction = new DbAbstraction();
    let response = {}
    let keys = await dbAbstraction.find(request.dsName, "metaData", { _id: `keys` }, {});
    console.log(keys[0]);
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
        console.log('Edit response: ', dbResponse);
        if (dbResponse.nModified == 1) {
            response.status = 'success';
        } else {
            response.status = 'fail';
            // Assumes that selector definitely has the '_id' field. 
            if (request.selectorObj._id) {
                // XXX: It works because updateOne call above fixed the _id format inside
                // selectorObj! 
                let recs = await dbAbstraction.find(request.dsName, "data", { _id: request.selectorObj._id }, {});
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
    await dbAbstraction.destroy()
    return response
}

function getSingleEditLog(req, isKey, status) {
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

function getKeyByValue(object, value) {
    return Object.keys(object).find(key => object[key] === value);
}

module.exports = {
    editSingleAttribute
}