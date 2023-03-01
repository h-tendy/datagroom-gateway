// @ts-check
var JiraApi = require('jira-client');
const { async } = require('regenerator-runtime');
const DbAbstraction = require('./dbAbstraction');
const JiraSettings = require('./jiraSettings');
const utils = require('./utils')
// Initialize

let host = JiraSettings.host;
var jira = new JiraApi(JiraSettings.settings);

let fields = ["summary", "assignee", "customfield_25901", "issuetype", "customfield_26397", "customfield_11504", "description", "priority", "reporter", "customfield_21091", "status", "customfield_25792", "customfield_25907", "customfield_25802", "created", "customfield_22013", "customfield_25582", "customfield_25588", "customfield_25791", "versions", "parent", "subtasks", "issuelinks", "updated", "votes", "customfield_25570", "labels", "customfield_25693", "customfield_25518", "customfield_12790", "customfield_11890", "customfield_11990", "jiraSummary", "fixVersions"];

let editableFieldsAndTypeMapping = {
    "description": 'string',
    "Story Points": 'number',
    "summary": 'string',
    "assignee": 'string',
    "sprintName": 'string',
}

let customFieldMapping = {
    "Story Points": "customfield_11890",
    "sprintName": "customfield_11990",
}

async function editSingleAttribute(req) {
    let response = {}
    let request = req.body
    let jiraAgileConfig = request.jiraAgileConfig
    let dbAbstraction = new DbAbstraction();

    let revContentMap = getRevContentMap(jiraAgileConfig)

    let keyBeingEdited = await ifKeyBeingEdited(request)
    utils.sanitizeData(request.editObj)
    /**Get the incoming edited record parsed */
    let ret = parseRecord(request.editObj, revContentMap, jiraAgileConfig.jiraFieldMapping)
    if (!ret.parseSuccess) {
        response.status = 'fail'
        response.error = 'unable to parse the incoming edited record according to given mapping'
        await insertInEditLog(request, keyBeingEdited, response.status)
        return response
    }
    let newUiRec = ret.rec
    request.editObj = getRecord(newUiRec, jiraAgileConfig)

    if (Object.keys(newUiRec).includes('key')) {
        response.status = 'fail'
        response.error = `Key for the JIRA_AGILE row can't be edited`
        await insertInEditLog(request, keyBeingEdited, response.status)
        return response
    }

    /**Get the old existing UI record parsed */
    ret = parseRecord(request.selectorObj, revContentMap, jiraAgileConfig.jiraFieldMapping)
    if (!ret.parseSuccess) {
        response.status = 'fail'
        response.error = 'unable to parse the current record according to given mapping'
        await insertInEditLog(request, keyBeingEdited, response.status)
        return response
    }
    let oldUiRec = ret.rec

    /**Compare which of the fields are edited by comparing oldUI and new UI rec and determine whether we support edit of those fields */
    let { isEditable, errorMsg } = isFieldEditable(oldUiRec, newUiRec)
    if (!isEditable) {
        response.status = 'fail'
        response.error = errorMsg
        await insertInEditLog(request, keyBeingEdited, response.status)
        return response
    }

    /**Get record from db and parse it accordingly */
    let recs = await dbAbstraction.find(request.dsName, "data", { _id: dbAbstraction.getObjectId(request.selectorObj._id) }, {});
    let record = recs[0]
    dbAbstraction.destroy()
    ret = parseRecord(record, revContentMap, jiraAgileConfig.jiraFieldMapping)
    if (!ret.parseSuccess) {
        response.status = 'fail'
        response.error = 'unable to parse the dbrecord according to given mapping'
        await insertInEditLog(request, keyBeingEdited, response.status)
        return response
    }
    let dbRec = ret.rec

    /**Get the latest record from JIRA if jira is enabled */
    let jiraIssueName = dbRec.key
    let latestJiraRec = null
    if (jiraAgileConfig && jiraAgileConfig.jira) {
        try {
            let issue = await jira.findIssue(jiraIssueName)
            latestJiraRec = utils.getRecFromJiraIssue(issue)
        } catch (e) {
            response.status = 'fail'
            response.error = 'unable to fetch the record from JIRA to update'
            await insertInEditLog(request, keyBeingEdited, response.status)
            return response
        }
    }

    if (latestJiraRec) {
        let isUpdated = isRecordUpdated(dbRec, latestJiraRec)
        if (!isUpdated) {
            response.status = 'fail'
            response.error = 'Stale JIRA entry found. Please refresh again.'
            await insertInEditLog(request, keyBeingEdited, response.status)
            return response
        }
    }

    let isUpdated = isRecordUpdated(oldUiRec, dbRec)
    if (!isUpdated) {
        response.status = 'fail'
        response.error = 'Stale JIRA entry found. Please refresh again.'
        await insertInEditLog(request, keyBeingEdited, response.status)
        return response
    }

    /**Compare the latest jira with that in db. If db is not updated send the message to the UI and cancel the edit operation */
    if (latestJiraRec) {
        let ret = await getEditedFieldsObj(oldUiRec, newUiRec, jiraAgileConfig.boardId)
        if (ret.errorMsg != '') {
            response.status = 'fail'
            response.error = ret.errorMsg
            await insertInEditLog(request, keyBeingEdited, response.status)
            return response
        }
        let editedObj = ret.editedJiraObj
        if (Object.keys(editedObj).length != 0) {
            try {
                let ret = await jira.updateIssue(jiraIssueName, { "fields": editedObj })
                console.log(ret)
            } catch (e) {
                response.status = 'fail'
                response.error = `unable to update the record to JIRA. Error: ${e.message}`
                await insertInEditLog(request, keyBeingEdited, response.status)
                return response
            }
        } else {
            /**This condition will be hit when only whitespace chars have been inserted into some field.
             * In those cases we can do silent fail, the UI will know the old val and it will revert to it.
             */
            response.status = 'silentFail'
            return response
        }
    }

    let responseFromDb = await writeToDb(request, keyBeingEdited)
    if (responseFromDb.status == 'success') {
        response = JSON.parse(JSON.stringify(responseFromDb))
        response.record = request.editObj
    }
    await insertInEditLog(request, keyBeingEdited, response.status)
    return response
}

function getRevContentMap(jiraConfig) {
    let jiraFieldMapping = jiraConfig.jiraFieldMapping
    jiraFieldMapping = JSON.parse(JSON.stringify(jiraFieldMapping));
    delete jiraFieldMapping.key;
    let revContentMap = {};
    for (let key in jiraFieldMapping) {
        let dsField = jiraFieldMapping[key];
        if (!revContentMap[dsField])
            revContentMap[dsField] = 1;
        else
            revContentMap[dsField] = revContentMap[dsField] + 1;
    }
    return revContentMap
}

function isFieldEditable(oldUiParsedRec, newUiParsedRec) {
    let isEditable = true
    let errorMsg = ''
    let editableFields = Object.keys(editableFieldsAndTypeMapping)
    for (let oldKeys of Object.keys(oldUiParsedRec)) {
        if (oldKeys == "jiraSummary") continue
        if (!newUiParsedRec[oldKeys]) continue
        if (newUiParsedRec[oldKeys] == oldUiParsedRec[oldKeys]) continue
        if (!editableFields.includes(oldKeys)) {
            isEditable = false
            errorMsg = `Jira key - ${oldKeys} is not supported for edit`
            break
        }
    }
    return { isEditable, errorMsg }
}

function isRecordUpdated(oldRec, newRec) {
    let isUpdated = true
    for (let oldKeys of Object.keys(oldRec)) {
        if (!newRec[oldKeys]) continue
        if (newRec[oldKeys] == oldRec[oldKeys]) {
            continue
        } else if (typeof (newRec[oldKeys]) == 'string' && typeof (oldRec[oldKeys]) == 'string' && newRec[oldKeys].trim() == oldRec[oldKeys].trim()) {
            continue
        } else {
            isUpdated = false
            break
        }
    }
    return isUpdated
}

async function getEditedFieldsObj(oldRec, newRec, boardId) {
    let editedJiraObj = {}
    let errorMsg = ''
    for (let newKey of Object.keys(newRec)) {
        if (newKey == "jiraSummary") continue
        if (oldRec[newKey] == newRec[newKey]) continue
        let jiraKey = newKey
        if (customFieldMapping[newKey]) {
            jiraKey = customFieldMapping[newKey]
        }
        if (!oldRec[newKey]) {
            if (fields.includes(jiraKey)) {
                if (jiraKey == "assignee") {
                    editedJiraObj[jiraKey] = { "name": newRec[newKey].trim() }
                } else if (newKey == "sprintName") {
                    let sprintId = await getSprintIdFromSprintName(newRec[newKey], boardId)
                    if (!sprintId) {
                        errorMsg = `Can't find the sprintId for the sprintName. Maybe you have to create one.`
                    } else {
                        editedJiraObj[jiraKey] = sprintId
                    }
                } else {
                    editedJiraObj[jiraKey] = newRec[newKey]
                }
            } else {
                continue
            }
        }
        if (!fields.includes(jiraKey)) continue
        if (typeof newRec[newKey] != editableFieldsAndTypeMapping[newKey]) {
            if (editableFieldsAndTypeMapping[newKey] == 'number' && typeof newRec[newKey] == 'string') {
                editedJiraObj[jiraKey] = parseInt(newRec[newKey])
            } else if (editableFieldsAndTypeMapping[newKey] == 'string' && typeof newRec[newKey] == 'number') {
                editedJiraObj[jiraKey] = newRec[newKey].toString()
            } else {
                errorMsg = `${newKey} should be ${editableFieldsAndTypeMapping[newKey]} type`
            }
        } else {
            if (jiraKey == "assignee") {
                editedJiraObj[jiraKey] = { "name": newRec[newKey].trim() }
            } else if (newKey == "sprintName") {
                let sprintId = await getSprintIdFromSprintName(newRec[newKey], boardId)
                if (!sprintId) {
                    errorMsg = `Can't find the sprintId for the sprintName. Maybe you have to create one.`
                } else {
                    editedJiraObj[jiraKey] = sprintId
                }
            } else {
                editedJiraObj[jiraKey] = newRec[newKey]
            }
        }
    }
    return { editedJiraObj, errorMsg }
}

/**
 * @param {string} sprintName
 * @param {string} boardId
 */
async function getSprintIdFromSprintName(sprintName, boardId) {
    let sprintId = null;
    try {
        let allSprints = await jira.getAllSprints(boardId);
        for (let element of allSprints.values) {
            if (element.name == sprintName.trim()) {
                sprintId = element.id
                break;
            }
        }
    } catch (e) {
        console.log(`Got error while retreiving sprintId for sprintName ${sprintName} for boardId ${boardId}`);
    }
    return sprintId
}

function parseRecord(dbRecord, revContentMap, jiraFieldMapping) {
    let dbKeys = Object.keys(dbRecord)
    let rec = {}
    let parseSuccess = true;
    let jiraUrl = "https://" + host;
    for (let dbKey of dbKeys) {
        let recKey = getKeyByValue(jiraFieldMapping, dbKey)
        if (!recKey) continue
        if (!revContentMap[dbKey]) {
            let recVal = dbRecord[dbKey]
            if (typeof recVal == 'string') {
                let regex = new RegExp(`${jiraUrl}/browse/(.*)\\)`)
                let jiraIssueIdMatchArr = recVal.match(regex)
                if (jiraIssueIdMatchArr && jiraIssueIdMatchArr.length >= 2) {
                    recVal = jiraIssueIdMatchArr[1].trim()
                }
            }
            rec[recKey] = recVal
            continue
        }
        if (revContentMap[dbKey] == 1) {
            let recVal = dbRecord[dbKey]
            if (typeof recVal == 'string') {
                let regex = new RegExp(`${jiraUrl}/browse/(.*)\\)`)
                let jiraIssueIdMatchArr = recVal.match(regex)
                if (jiraIssueIdMatchArr && jiraIssueIdMatchArr.length >= 2) {
                    recVal = jiraIssueIdMatchArr[1].trim()
                }
            }
            if (recKey == 'jiraSummary') {
                let arr = recVal.split('\n');
                if (arr.length >= 2) {
                    const output = recVal.split('\n')[0];
                    rec['summary'] = output
                } else {
                    const regex = /\s*\([^)]*\)/;
                    const output = recVal.replace(regex, '');
                    rec['summary'] = output
                }
            }
            rec[recKey] = recVal
        } else {
            let dbVal = dbRecord[dbKey]
            let dbValArr = dbVal.split("<br/>")
            for (let eachEntry of dbValArr) {
                let eachEntryKeyMatchArr = eachEntry.match(/\*\*(.*)\*\*:(.*)/s)
                if (eachEntryKeyMatchArr && eachEntryKeyMatchArr.length >= 3) {
                    let recKey = eachEntryKeyMatchArr[1].trim()
                    let recVal = eachEntryKeyMatchArr[2].trim()
                    let regex = new RegExp(`${jiraUrl}/browse/(.*)\\)`)
                    let jiraIssueIdMatchArr = recVal.match(regex)
                    if (recKey == 'key' && jiraIssueIdMatchArr && jiraIssueIdMatchArr.length >= 2) {
                        recVal = jiraIssueIdMatchArr[1]
                    }
                    if (recKey == 'jiraSummary') {
                        let arr = recVal.split('\n');
                        if (arr.length >= 2) {
                            const output = recVal.split('\n')[0];
                            rec['summary'] = output
                        } else {
                            const regex = /\s*\([^)]*\)/;
                            const output = recVal.replace(regex, '');
                            rec['summary'] = output
                        }
                    }
                    rec[recKey] = recVal
                }
            }
        }
    }
    return { rec, parseSuccess }
}

async function ifKeyBeingEdited(request) {
    let dbAbstraction = new DbAbstraction();
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
    await dbAbstraction.destroy()
    return keyBeingEdited
}

async function writeToDb(request, keyBeingEdited) {
    let dbAbstraction = new DbAbstraction();
    let response = {}
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
    return response
}

async function insertInEditLog(request, keyBeingEdited, status) {
    let dbAbstraction = new DbAbstraction();
    let editLog = getSingleEditLog(request, keyBeingEdited, status);
    let editLogResp = await dbAbstraction.insertOne(request.dsName, "editlog", editLog);
    console.log('editLog (edit) response: ', editLogResp);
    await dbAbstraction.destroy()
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

function getRecord(rec, jiraConfig) {
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

    let fullRec = {}

    for (let key in jiraContentMapping) {
        // We want to sprintName in UI even if it is empty
        if (!rec[key]) continue;
        if (!fullRec[jiraContentMapping[key]]) {
            if (revContentMap[jiraContentMapping[key]] > 1)
                if (key == "subtasksDetails" || key == "dependsLinks" || key == "implementLinks" || key == "packageLinks" || key == "relatesLinks" || key == "testLinks" || key == "coversLinks" || key == "defectLinks" || key == "automatesLinks") {
                    fullRec[jiraContentMapping[key]] = `**${key}**:\n ${rec[key]}\n` + "<br/>\n\n";
                } else {
                    if (rec[key] == "") {
                        fullRec[jiraContentMapping[key]] = `**${key}**:\n` + "<br/>\n";
                    } else {
                        fullRec[jiraContentMapping[key]] = `**${key}**:\n ${rec[key]}\n` + "<br/>\n";
                    }
                }
            else
                fullRec[jiraContentMapping[key]] = rec[key];
        } else {
            let recValue;
            if (key == "subtasksDetails" || key == "dependsLinks" || key == "implementLinks" || key == "packageLinks" || key == "relatesLinks" || key == "testLinks" || key == "coversLinks" || key == "defectLinks" || key == "automatesLinks") {
                recValue = `**${key}**:\n ${rec[key]}\n` + "<br/>\n\n";
            } else {
                if (rec[key] == "") {
                    recValue = `**${key}**:\n` + "<br/>\n";
                } else {
                    recValue = `**${key}**:\n ${rec[key]}\n` + "<br/>\n";
                }
            }
            fullRec[jiraContentMapping[key]] += recValue;
        }
    }
    return fullRec
}

module.exports = {
    editSingleAttribute
}