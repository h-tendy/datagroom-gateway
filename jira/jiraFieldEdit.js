//@ts-check
const DbAbstraction = require('../dbAbstraction');
const utils = require('../utils');
const JiraSettings = require('../jiraSettings');
var JiraApi = require('jira-client');
const logger = require('../logger');
const {jiraFields} = require('./jiraCommons');

let host = JiraSettings.host;
var jira = new JiraApi(JiraSettings.settings);

let editableFieldsAndTypeMapping = {
    "description": 'string',
    "Story Points": 'number',
    "summary": 'string',
    "assignee": 'string',
    "Acceptance Criteria": 'string',
    "Notes": 'string',
}

let customFieldMapping = {
    "Story Points": "customfield_11890",
    "Acceptance Criteria": "customfield_25523",
    "Notes": "customfield_22792",
}


/**
 * Given a request body, this function goes onto edit a single field of the whole object.
 * The single field can be JIRA field. In that case, we have to update the JIRA backend and as well as the DB.
 * IF the field is not one of the JIRA field, then we have to just update the DB.
 * @param {object} req 
 * @returns 
 */
async function editSingleAttribute(req) {
    let response = {}
    let request = req.body
    let jiraConfig = request.jiraConfig
    let dbAbstraction = new DbAbstraction();

    let revContentMap = utils.getRevContentMap(jiraConfig)
    let editedCol = request.column;
    if (!editedCol) {
        response.status = 'fail'
        response.error = 'unable to get edited column attribute'
        await insertInEditLog(request, request.key, response.status)
        return response
    }
    let keyBeingEdited = await ifKeyBeingEdited(request)
    /* If the column being edited is mapped to JIRA, then go in the if block and finally make the request to JIRA backend.
    Otherwise, skip this block and directly update the db. */
    if (isJiraMappedColumnBeingEdited(editedCol, jiraConfig)) {
        utils.sanitizeData(request.editObj)
        /**Get the incoming edited record parsed */
        let ret = utils.parseRecord(request.editObj, revContentMap, jiraConfig.jiraFieldMapping)
        if (!ret.parseSuccess) {
            response.status = 'fail'
            response.error = 'unable to parse the incoming edited record according to given mapping'
            await insertInEditLog(request, keyBeingEdited, response.status)
            return response
        }
        let newUiRec = ret.rec
        request.editObj = getRecord(newUiRec, jiraConfig)

        if (Object.keys(newUiRec).includes('key')) {
            response.status = 'fail'
            response.error = `Key for the JIRA row can't be edited`
            await insertInEditLog(request, keyBeingEdited, response.status)
            return response
        }

        /**Get the old existing UI record parsed */
        ret = utils.parseRecord(request.selectorObj, revContentMap, jiraConfig.jiraFieldMapping)
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
        ret = utils.parseRecord(record, revContentMap, jiraConfig.jiraFieldMapping)
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
        if (jiraConfig && jiraConfig.jira) {
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
            let ret = await getEditedFieldsObj(oldUiRec, newUiRec)
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
                    logger.info(ret, "Record updated in JIRA");
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
    }

    let responseFromDb = await writeToDb(request, keyBeingEdited)
    if (responseFromDb.status == 'success') {
        response = JSON.parse(JSON.stringify(responseFromDb))
        response.record = request.editObj
    }
    await insertInEditLog(request, keyBeingEdited, response.status)
    return response
}

async function insertInEditLog(request, keyBeingEdited, status) {
    let dbAbstraction = new DbAbstraction();
    let editLog = getSingleEditLog(request, keyBeingEdited, status);
    let editLogResp = await dbAbstraction.insertOne(request.dsName, "editlog", editLog);
    logger.info(editLogResp, "Edit log response from DB");
}

function getSingleEditLog(req, isKey, status) {
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

async function ifKeyBeingEdited(request) {
    let dbAbstraction = new DbAbstraction();
    let keys = await dbAbstraction.find(request.dsName, "metaData", { _id: `keys` }, {});
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
    return keyBeingEdited
}

/**
 * Given a column that is being edited, this function returns true if that column is mappend in jiraConfig.
 * If the column is mapped in jiraConfig, this means that the column has dependency on JIRA. It's not just between DG and DG backend.
 * @param {string} columnBeingEdited 
 * @param {object} jiraConfig 
 * @returns {boolean}
 */
function isJiraMappedColumnBeingEdited(columnBeingEdited, jiraConfig) {
    let isJiraColumnBeingEdited = false;
    if (!jiraConfig) return false;
    let jiraFieldMapping = jiraConfig.jiraFieldMapping
    jiraFieldMapping = JSON.parse(JSON.stringify(jiraFieldMapping));
    // iterate over values of jiraFieldMapping
    for (let key in jiraFieldMapping) {
        let dsField = jiraFieldMapping[key];
        if (dsField == columnBeingEdited) {
            isJiraColumnBeingEdited = true;
            break;
        }
    }
    return isJiraColumnBeingEdited;
}

/**
 * Given a record that is key value supported by the JIRA. This function returns a new object that is written in DB.
 * The object that is written in DB accounts for the mapping provided in the jiraConfig and forms the new object accordingly.
 * For example, there can be multiple key in the JIRA rec object that are mapped to the same column in the DG. 
 * Those types of records are formatted accordingly and put in the fullRec object that is returned.
 * @param {object} rec 
 * @param {object} jiraConfig 
 * @returns {object}
 */
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
        // Check for undefined or null. because there can be empty string for a key being edited, if the user is getting rid of all entry
        if (rec[key] === undefined || rec[key] === null) continue;
        if (!fullRec[jiraContentMapping[key]]) {
            if (revContentMap[jiraContentMapping[key]] > 1)
                if (key == "subtasksDetails" || key == "dependsLinks" || key == "implementLinks" || key == "packageLinks" || key == "relatesLinks" || key == "testLinks" || key == "coversLinks" || key == "defectLinks" || key == "automatesLinks") {
                    fullRec[jiraContentMapping[key]] = `**${key}**:\n ${rec[key]}\n` + "<br/>\n\n";
                } else if (key == "description" || key == "Acceptance Criteria") {
                    fullRec[jiraContentMapping[key]] = `\n**${key}**:\n ${rec[key]}\n` + "<br/>\n";
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
            } else if (key == "description" || key == "Acceptance Criteria") {
                recValue = `\n**${key}**:\n ${rec[key]}\n` + "<br/>\n";
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

/**
 * Given the old record and the new record, this function checks if the key that is being edited is supported for edit.
 * If yes, then returns true. Otherwise, returns false with proper error msg that should be handled at the caller of this function.
 * @param {object} oldUiParsedRec 
 * @param {object} newUiParsedRec 
 * @returns {{isEditable: boolean, errorMsg: string}}
 */
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


/**
 * Given the 2 different records object, this function checks the difference between both the records.
 * Returns true if the newRec is the same as oldRec and false otherwise.
 * Meaning the oldRec and the newRec should be of the same version, then it will return true signifying we have the updated record.
 * @param {object} oldRec 
 * @param {object} newRec 
 * @returns {boolean}
 */
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

/**
 * This function takes the oldRec that is existing and newRec that is coming from UI after editing.
 * Returns an object that contains the edited fields with the key and value in proper format that is required for making the request to JIRA.
 * Also, it return any errorMsg in string that is to be processed by the caller of this function
 * @param {object} oldRec 
 * @param {object} newRec 
 * @returns {Promise<object>}
 */
async function getEditedFieldsObj(oldRec, newRec) {
    let editedJiraObj = {}
    let errorMsg = ''
    for (let newKey of Object.keys(newRec)) {
        // TODO: Give explanation of why are we continuing for jiraSummary
        if (newKey == "jiraSummary") continue
        // If the the value has not changed for the key, continue
        if (oldRec[newKey] == newRec[newKey]) continue
        let jiraKey = newKey
        // For some fields the key value coming from the UI will not be same as the jira key, we have to update the jira key for the key here.
        if (customFieldMapping[newKey]) {
            jiraKey = customFieldMapping[newKey]
        }
        if (!oldRec[newKey]) {
            // Check if the required jira key is among one of the fields that are supported by DG. If not, continue to the next key.
            if (jiraFields.includes(jiraKey)) {
                if (jiraKey == "assignee") {
                    editedJiraObj[jiraKey] = { "name": newRec[newKey].trim() }
                } else {
                    editedJiraObj[jiraKey] = newRec[newKey]
                }
            } else {
                continue
            }
        }
        // If the edited jiraKey is not included among the fields that are supported by DG, then continue to the next key.
        if (!jiraFields.includes(jiraKey)) continue
        // For some edited keys that come from UI has the string value. But, it should be otherwise while making request to JIRA.
        // Check the required type mapping for those fields in the editableFieldsAndTypeMapping and populate editedJiraObj accordingly with the right type of value.
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
            } else {
                editedJiraObj[jiraKey] = newRec[newKey]
            }
        }
    }
    return { editedJiraObj, errorMsg }
}

async function writeToDb(request, keyBeingEdited) {
    let dbAbstraction = new DbAbstraction();
    let response = {}
    if (keyBeingEdited) {
        logger.info("A key is being edited: Do in transaction");
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
        logger.info(dbResponse, "Edit response from DB");
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
        logger.error(e, `Got error while retreiving sprintId for Sprint Name ${sprintName} for boardId ${boardId}`);
    }
    return sprintId
}

module.exports = {
    editSingleAttribute
}