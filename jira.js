var JiraApi = require('jira-client');
const DbAbstraction = require('./dbAbstraction');
const JiraSettings = require('./jiraSettings');
const utils = require('./utils')
const fetch = require('node-fetch')
const JIRA_AGILE = require('./jiraAgile')
// Initialize

let host = JiraSettings.host;
var jira = new JiraApi(JiraSettings.settings);

let filteredProjectsMetaData = {}

// Custom fields per installation
let fields = ["summary", "assignee", "customfield_25901", "issuetype", "customfield_26397", "customfield_11504", "description", "priority", "reporter", "customfield_21091", "status", "customfield_25792", "customfield_25907", "customfield_25802", "created", "customfield_22013", "customfield_25582", "customfield_25588", "customfield_25791", "versions", "parent", "subtasks", "issuelinks", "updated", "votes", "customfield_25570", "labels", "customfield_25693", "customfield_25518", "customfield_12790", "customfield_11890", "customfield_11990", "jiraSummary", "fixVersions", "customfield_28097", "duedate", "customfield_25555"];
// Must have 'Work-id' and 'Description' fields in the data-set. 
// The keys for this dataset must include 'Work-id' for now. 
// 'Work-id' and 'Description' will get populated from Jira. 
// You can have additional rows and they won't get touched. 
// If you change 'Description', you'll lose it when it next updates. 
// Make it possible for users to specify the jql. 

async function refreshJiraQuery(dsName, jiraConfig) {
    let startAt = 0; let total = 0;
    let resultRecords = [];
    let names, results;
    let jql = jiraConfig.jql
    await markAsStale(dsName, jiraConfig);

    if (jiraConfig._id == "jiraAgileConfig") {
        jql = await getJiraAgileJql(jiraConfig)
    }

    //TODO: Better error msg to frontend. For now, it's ok.
    if (!jql) return
    do {
        console.log("Fetching from: ", startAt);
        // Comment out 'fields' below for getting all fields for field exploration. 
        results = await jira.searchJira(jql, { startAt, fields, expand: ["names"] });
        startAt += results.issues.length;
        names = results.names;
        for (let i = 0; i < results.issues.length; i++) {
            let issue = results.issues[i];
            let rec = utils.getRecFromJiraIssue(issue)
            resultRecords.push(rec);
            // Use this for new field explorations.
            if (issue.fields.customfield_25588) {
                console.log("\n\n\nGOT a non-null: ", issue.fields.customfield_25588);
                console.log("\n\n\n");
            }

            if (i == 0) {
                //if (true) {
                console.log(JSON.stringify(issue, null, 4));
                console.log("Do figure out jira names: ", names)
            }
        }
    } while (startAt < results.total)

    // Db stunts
    let dbAbstraction = new DbAbstraction();
    /*
    let keys = await dbAbstraction.find(dsName, "metaData", { _id: `keys` }, {} );
    console.log("keys: ", keys[0]);
    keys = keys[0].keys; 
    let keysMapping = {'Work-id' : 'key'} */
    for (let i = 0; i < resultRecords.length; i++) {
        let rec = resultRecords[i], r;

        if (!jiraConfig.jiraFieldMapping || !Object.keys(jiraConfig.jiraFieldMapping).length) {
            r = defaultJiraMapping(rec, jiraConfig);
        } else {
            r = doJiraMapping(rec, jiraConfig);
        }
        console.log("selectorObj: ", r.selectorObj);
        console.log("FullRec: ", r.fullRec);
        try {
            await dbAbstraction.update(dsName, "data", r.selectorObj, r.fullRec);
        } catch (e) {
            console.log("Db update error refreshJiraQuery: ", e);
        }
    }
    await dbAbstraction.destroy();
}

function doJiraMapping(rec, jiraConfig) {
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

    let selectorObj = {}, fullRec = {};
    //selectorObj[jiraKeyMapping['key']] = {$regex: `${rec.key}$`, $options: 'i'};
    if (jiraConfig._id == "jiraAgileConfig") {
        fullRec[jiraKeyMapping['key']] = `[JIRA_AGILE-${rec.key}](${jiraUrl + '/browse/' + rec.key})`;
        selectorObj[jiraKeyMapping['key']] = `[JIRA_AGILE-${rec.key}](${jiraUrl + '/browse/' + rec.key})`;
    } else {
        fullRec[jiraKeyMapping['key']] = `[${rec.key}](${jiraUrl + '/browse/' + rec.key})`;
        selectorObj[jiraKeyMapping['key']] = `[${rec.key}](${jiraUrl + '/browse/' + rec.key})`;
    }

    for (let key in jiraContentMapping) {
        // We want to sprintName in UI even if it is empty
        if (!rec[key] && key != "sprintName") continue;
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
    return { selectorObj, fullRec }
}

function defaultJiraMapping(rec, jiraConfig) {
    let jiraUrl = "https://" + host;
    let jiraKeyMapping = { 'key': 'Work-id' }
    // No need for "Details" links to appear here. 
    let jiraContentMapping = { 'summary': 'Description', 'type': 'Description', 'assignee': 'Description', 'severity': 'Description', 'priority': 'Description', 'foundInRls': 'Description', 'reporter': 'Description', 'created': 'Description', 'rrtTargetRls': 'Description', 'targetRls': 'Description', 'status': 'Description', 'feature': 'Description', 'rzFeature': 'Description', 'versions': 'Description', 'parentKey': 'Description', 'parentSummary': 'Description', 'parent': 'Description', 'subtasks': 'Description', 'labels': 'Description', 'phaseBugFound': 'Description', 'phaseBugIntroduced': 'Description', 'epic': 'Description', 'description': 'Description', 'Story Points': 'Description', 'sprintName': 'Description', 'jiraSummary': 'Description', 'fixVersions': 'Description', 'agileCommit': 'Description', "duedate": 'Description', "targetRlsGx": 'Description' };
    let selectorObj = {}, fullRec = {};
    if (jiraConfig._id == "jiraAgileConfig") {
        selectorObj[jiraKeyMapping['key']] = `[JIRA_AGILE-${rec.key}](${jiraUrl + '/browse/' + rec.key})`;
        fullRec[jiraKeyMapping['key']] = `[JIRA_AGILE-${rec.key}](${jiraUrl + '/browse/' + rec.key})`;
    } else {
        selectorObj[jiraKeyMapping['key']] = `[${rec.key}](${jiraUrl + '/browse/' + rec.key})`;
        fullRec[jiraKeyMapping['key']] = `[${rec.key}](${jiraUrl + '/browse/' + rec.key})`;
    }

    for (key in jiraContentMapping) {
        recValue = `**${key}**: ${rec[key]}`;
        if (!fullRec[jiraContentMapping[key]]) {
            fullRec[jiraContentMapping[key]] = recValue;
        } else {
            let ws = " ";
            ws = "\n\n";
            // XXX: Yuk, better way to insert the newlines. 
            if (key === "type") ws = "\n\n";
            fullRec[jiraContentMapping[key]] += ws + recValue;
        }
    }
    return { selectorObj, fullRec }
}

async function markAsStale(dsName, jiraConfig) {
    let jiraUrl = "https://" + host;
    let jiraFieldMapping;
    if (!jiraConfig.jiraFieldMapping || !Object.keys(jiraConfig.jiraFieldMapping).length) {
        // No need for "Details" links to appear here. 
        jiraFieldMapping = { 'key': 'Work-id', 'summary': 'Description', 'type': 'Description', 'assignee': 'Description', 'severity': 'Description', 'priority': 'Description', 'foundInRls': 'Description', 'reporter': 'Description', 'created': 'Description', 'rrtTargetRls': 'Description', 'targetRls': 'Description', 'status': 'Description', 'feature': 'Description', 'rzFeature': 'Description', 'versions': 'Description', 'parentKey': 'Description', 'parentSummary': 'Description', 'parent': 'Description', 'subtasks': 'Description', 'labels': 'Description', 'phaseBugFound': 'Description', 'phaseBugIntroduced': 'Description', 'epic': 'Description', 'description': 'Description', 'Story Points': 'Description', 'sprintName': 'Description', 'jiraSummary': 'Description', 'fixVersions': 'Description', 'agileCommit': 'Description', "duedate": 'Description', "targetRlsGx": 'Description' };
    } else {
        jiraFieldMapping = JSON.parse(JSON.stringify(jiraConfig.jiraFieldMapping));
    }
    let jiraKeyMapping = { 'key': jiraFieldMapping['key'] };
    delete jiraFieldMapping.key;
    let jiraContentMapping = jiraFieldMapping;

    let filters = {}; sorters = [];
    try {
        if (jiraConfig._id == "jiraAgileConfig") {
            filters[jiraKeyMapping['key']] = { $regex: `JIRA_AGILE.*${jiraUrl + '/browse/'}`, $options: 'i' };
        } else {
            filters[jiraKeyMapping['key']] = { $regex: `^((?!JIRA_AGILE).)*${jiraUrl + '/browse/'}.*`, $options: 'im' };
        }
        //filters[jiraKeyMapping['key']] = {$regex: `IQN-`, $options: 'i'};
    } catch (e) { }
    // XXX: Do lots of validation.
    //console.log("mongo filters: ", filters);
    let dbAbstraction = new DbAbstraction();
    let response = {};
    let page = 1, perPage = 5;
    try {
        do {
            response = await dbAbstraction.pagedFind(dsName, 'data', filters, {}, page, perPage);
            //console.log("Response: ", response);
            page += 1;

            for (let i = 0; i < response.data.length; i++) {
                let rec = response.data[i];
                let selectorObj = {}, jiraColumns = {};
                selectorObj._id = rec._id;
                // Do something to all jira columns
                let alreadyStale = false;

                // Stale marking only in 'summary' column. 
                if (jiraContentMapping['summary']) {
                    if (/ENTRY NO LONGER PRESENT IN/.test(rec[jiraContentMapping['summary']])) {
                        alreadyStale = true;
                        continue;
                    }
                    jiraColumns[jiraContentMapping['summary']] = '[ENTRY NO LONGER PRESENT IN JIRA QUERY]{.y}\n\n' + rec[jiraContentMapping['summary']];
                } else if (jiraContentMapping['jiraSummary']) {
                    if (/ENTRY NO LONGER PRESENT IN/.test(rec[jiraContentMapping['jiraSummary']])) {
                        alreadyStale = true;
                        continue;
                    }
                    jiraColumns[jiraContentMapping['jiraSummary']] = '[ENTRY NO LONGER PRESENT IN JIRA QUERY]{.y}\n\n' + rec[jiraContentMapping['jiraSummary']];
                }

                /* // Comment out stale marking in all fields.
                for (let jiraKey in jiraContentMapping) {
                    if (/ENTRY NO LONGER PRESENT IN/.test(rec[jiraContentMapping[jiraKey]])) {
                        alreadyStale = true;
                        break;
                    }
                    jiraColumns[jiraContentMapping[jiraKey]] = '[ENTRY NO LONGER PRESENT IN JIRA QUERY]{.y}\n\n' + rec[jiraContentMapping[jiraKey]];
                }
                if (alreadyStale) continue;
                */
                try {
                    await dbAbstraction.update(dsName, "data", selectorObj, jiraColumns);
                } catch (e) {
                    console.log("Db update error in markAsStale : ", e);
                }
            }
        } while (page <= response.total_pages)
    } catch (e) { }
    await dbAbstraction.destroy();
}


function getSubTasksDetailsInTable(issue) {
    let subtasksDetails = "";
    if (issue.fields.subtasks && issue.fields.subtasks.length) {
        subtasksDetails = "<table>";
        subtasksDetails += "<tr>";
        subtasksDetails += "<th>Key</th> <th>Type</th> <th>Summary</th> <th>Status</th> <th>Priority</th>"
        subtasksDetails += "</tr>";
        for (let i = 0; i < issue.fields.subtasks.length; i++) {
            subtasksDetails += "<tr>";
            subtasksDetails += "<td>" + issue.fields.subtasks[i].key + "</td>";
            subtasksDetails += "<td>" + issue.fields.subtasks[i].fields.issuetype.name + "</td>";
            subtasksDetails += "<td>" + issue.fields.subtasks[i].fields.summary + "</td>";
            subtasksDetails += "<td>" + issue.fields.subtasks[i].fields.status.name + "</td>";
            subtasksDetails += "<td>" + issue.fields.subtasks[i].fields.priority.name + "</td>";
            subtasksDetails += "</tr>";
        }
        subtasksDetails += "</table>";
    }
    return subtasksDetails;
}

async function createFilteredProjectsMetaData() {
    try {
        let defaultTypeFieldsAndValues = JiraSettings.defaultTypeFieldsAndValues
        let expectedProjects = []
        for (let projectObj of defaultTypeFieldsAndValues.projects) {
            expectedProjects.push(projectObj.key)
        }
        let origProjectsMetaData = await jira.getIssueCreateMetadata({
            projectKeys: expectedProjects,
            expand: ["projects.issuetypes.fields"]
        })
        filteredProjectsMetaData.projects = []
        for (let i = 0; i < origProjectsMetaData.projects.length; i++) {
            if (!expectedProjects.includes(origProjectsMetaData.projects[i].key)) continue
            let currOrigProjectMetaData = origProjectsMetaData.projects[i];
            let currFilteredProjectMetaData = {};
            currFilteredProjectMetaData.key = currOrigProjectMetaData.key
            currFilteredProjectMetaData.issuetypes = [];
            for (let j = 0; j < currOrigProjectMetaData.issuetypes.length; j++) {
                if (!getIssueTypesForGivenProject(currFilteredProjectMetaData.key).includes(currOrigProjectMetaData.issuetypes[j].name)) continue
                let currOrigProjectIssueTypeMetaData = currOrigProjectMetaData.issuetypes[j];
                let currFilteredProjectIssueTypeMetaData = {}
                currFilteredProjectIssueTypeMetaData.name = currOrigProjectIssueTypeMetaData.name
                currFilteredProjectIssueTypeMetaData.fields = {}
                for (let field of Object.keys(currOrigProjectIssueTypeMetaData.fields)) {
                    if (field == "project" || field == "issuetype") continue
                    if (!getFieldsForGivenProjectAndIssueType(currFilteredProjectMetaData.key, currFilteredProjectIssueTypeMetaData.name).includes(field)) continue;
                    let currOrigIssueTypeFieldObj = currOrigProjectIssueTypeMetaData.fields[field]
                    currFilteredProjectIssueTypeMetaData.fields[field] = {}
                    currFilteredProjectIssueTypeMetaData.fields[field].required = currOrigIssueTypeFieldObj.required
                    currFilteredProjectIssueTypeMetaData.fields[field].type = currOrigIssueTypeFieldObj.schema.type
                    currFilteredProjectIssueTypeMetaData.fields[field].name = currOrigIssueTypeFieldObj.name
                    currFilteredProjectIssueTypeMetaData.fields[field].hasDefaultValue = currOrigIssueTypeFieldObj.hasDefaultValue
                    if (currOrigIssueTypeFieldObj.allowedValues) {
                        currFilteredProjectIssueTypeMetaData.fields[field].allowedValues = []
                        for (let k = 0; k < currOrigIssueTypeFieldObj.allowedValues.length; k++) {
                            if (currOrigIssueTypeFieldObj.allowedValues[k].value) {
                                currFilteredProjectIssueTypeMetaData.fields[field].allowedValues.push(currOrigIssueTypeFieldObj.allowedValues[k].value)
                            } else if (currOrigIssueTypeFieldObj.allowedValues[k].name) {
                                currFilteredProjectIssueTypeMetaData.fields[field].allowedValues.push(currOrigIssueTypeFieldObj.allowedValues[k].name)
                            }
                        }
                    }
                }
                currFilteredProjectMetaData.issuetypes.push(currFilteredProjectIssueTypeMetaData)
            }
            filteredProjectsMetaData.projects.push(currFilteredProjectMetaData)
        }
    } catch (e) {
        console.log("Error in createFilteredProjectsMetaData", e)
    }
    console.log("Filtered meta data updated", filteredProjectsMetaData)
    setTimeout(createFilteredProjectsMetaData, JiraSettings.jiraMetaDataRefreshIntervalInMs)
}

function getIssueTypesForGivenProject(projectKey) {
    let defaultProjects = JiraSettings.defaultTypeFieldsAndValues.projects
    for (let projectObj of defaultProjects) {
        if (projectObj.key != projectKey) continue
        return Object.keys(projectObj.issuetypes)
    }
    return []
}

function getFieldsForGivenProjectAndIssueType(projectKey, issuetype) {
    try {
        let defaultProjects = JiraSettings.defaultTypeFieldsAndValues.projects
        for (let projectObj of defaultProjects) {
            if (projectObj.key != projectKey) continue
            return Object.keys(projectObj.issuetypes[issuetype])
        }
    } catch (e) {
        return []
    }
    return []
}

async function getAllAssigneesForJira(dsName, jiraConfig) {
    let assignees = new Set();
    let dbAbstraction = new DbAbstraction();
    let jiraUrl = "https://" + host;
    let revContentMap = utils.getRevContentMap(jiraConfig)
    try {
        if (!jiraConfig.jiraFieldMapping.key) {
            return Array.from(assignees);
        }
        let filters = {}
        let mappedColumn = jiraConfig.jiraFieldMapping.key;
        filters[mappedColumn] = { $regex: `^((?!JIRA_AGILE).)*${jiraUrl + '/browse/'}.*`, $options: 'im' };
        let page = 1, perPage = 5;
        let response = {};
        do {
            response = await dbAbstraction.pagedFind(dsName, "data", filters, {}, page, perPage)
            page += 1;
            for (let i = 0; i < response.data.length; i++) {
                console.log(response.data[i]);
                let ret = utils.parseRecord(response.data[i], revContentMap, jiraConfig.jiraFieldMapping)
                if (!ret.parseSuccess) {
                    console.log('unable to parse the record while getting assignees for all jiraAgileRows')
                    return assignees
                }
                let jiraRec = ret.rec
                let assignee = jiraRec.assignee;
                if (assignee && assignee != "NotSet") {
                    assignees.add(assignee)
                }
            }
        } while (page <= response.total_pages)
    } catch (e) {
        console.log("Error in getAllAssigneesForJiraAgile", e)
    }
    dbAbstraction.destroy();
    return Array.from(assignees);
}

async function addDynamicFieldsToProjectsMetaData(dsName, jiraConfig, jiraAgileConfig) {
    let memo = {
        "jiraAssignees": null,
        "jiraAgileAssignees": null,
        "epics": null,
        "stories": null,
    }
    try {
        for (let i = 0; i < filteredProjectsMetaData.projects.length; i++) {
            let currProject = filteredProjectsMetaData.projects[i];
            for (let j = 0; j < currProject.issuetypes.length; j++) {
                let currIssuetype = currProject.issuetypes[j];
                for (let field of Object.keys(currIssuetype.fields)) {
                    if (field == "assignee") {
                        if (currIssuetype.name == "Bug") {
                            currIssuetype.fields[field].type = "creatableArray"
                            if (!memo.jiraAssignees) {
                                memo.jiraAssignees = await getAllAssigneesForJira(dsName, jiraConfig)
                            }
                            currIssuetype.fields[field].allowedValues = memo.jiraAssignees
                        } else {
                            currIssuetype.fields[field].type = "creatableArray"
                            if (!memo.jiraAgileAssignees) {
                                memo.jiraAgileAssignees = await JIRA_AGILE.getAllAssigneesForJiraAgile(dsName, jiraAgileConfig)
                            }
                            currIssuetype.fields[field].allowedValues = memo.jiraAgileAssignees
                        }
                    } else if (currIssuetype.fields[field].name == "Epic Link") {
                        currIssuetype.fields[field].type = "searchableOption";
                        if (!memo.epics) {
                            memo.epics = await JIRA_AGILE.getIssuesForGivenTypes("Epic", dsName, jiraAgileConfig)
                        }
                        currIssuetype.fields[field].allowedValues = memo.epics
                    } else if (currIssuetype.name == "Story Task" && field == "parent") {
                        currIssuetype.fields[field].type = "searchableOption";
                        if (!memo.stories) {
                            memo.stories = await JIRA_AGILE.getIssuesForGivenTypes("Story", dsName, jiraAgileConfig)
                        }
                        currIssuetype.fields[field].allowedValues = memo.stories;
                    }
                }
            }
        }
    } catch (e) {
        console.log("Error in addDynamicFieldsToProjectsMetaData", e)
    }
}

async function getProjectsMetaData(dsName, jiraConfig, jiraAgileConfig) {
    await addDynamicFieldsToProjectsMetaData(dsName, jiraConfig, jiraAgileConfig)
    return filteredProjectsMetaData
}

function getDefaultTypeFieldsAndValues() {
    return JiraSettings.defaultTypeFieldsAndValues
}

async function createJiraIssue(jiraFormData) {
    let response = {}
    // let jiraFormData = request.jiraFormData
    let issueType = jiraFormData.Type
    let bodyData = null
    if (issueType == "Bug") {
        // TODO: Can be made more generic. For future??
        let versions = jiraFormData[issueType]["versions"].map((version) => { return { "name": version } });
        let customfield_25558_values = jiraFormData[issueType]["customfield_25558"].map((entry) => { return { "value": entry } });
        let customfield_21295_values = jiraFormData[issueType]["customfield_21295"].map((entry) => { return { "name": entry } });
        let customfield_25555_values = jiraFormData[issueType]["customfield_25555"].map((entry) => { return { "value": entry } });
        let customfield_25554_values = jiraFormData[issueType]["customfield_25554"].map((entry) => { return { "value": entry } });
        bodyData = {
            "fields": {
                "description": jiraFormData[jiraFormData.Type].description,
                "issuetype": {
                    "name": jiraFormData.Type
                },
                "labels": [
                    jiraFormData.JIRA_AGILE_LABEL
                ],
                "priority": {
                    "name": jiraFormData[jiraFormData.Type].priority
                },
                "project": {
                    "key": jiraFormData.Project
                },
                "summary": jiraFormData[jiraFormData.Type].summary,
                "versions": versions,
                "customfield_25563": {
                    "value": jiraFormData[jiraFormData.Type].customfield_25563
                },
                "customfield_25716": {
                    "value": jiraFormData[jiraFormData.Type].customfield_25716
                },
                "customfield_25558": customfield_25558_values,
                "customfield_25570": {
                    "value": jiraFormData[jiraFormData.Type].customfield_25570
                },
                "customfield_11504": {
                    "value": jiraFormData[jiraFormData.Type].customfield_11504
                },
                "customfield_21295": customfield_21295_values,
                "customfield_25578": jiraFormData[jiraFormData.Type].customfield_25578,
                "customfield_25555": customfield_25555_values,
                "customfield_25518": {
                    "value": jiraFormData[jiraFormData.Type].customfield_25518
                },
                "assignee": {
                    "name": jiraFormData[jiraFormData.Type].assignee
                },
                "customfield_25554": customfield_25554_values
            },
            "update": {}
        };
    } else if (issueType == "Story") {
        let fixVersions = jiraFormData[issueType]["fixVersions"].map((version) => { return { "name": version } });
        let customfield_28097_values = jiraFormData[issueType]["customfield_28097"].map((entry) => { return { "name": entry } });
        let customfield_26394_values = jiraFormData[issueType]["customfield_26394"].map((entry) => { return { "value": entry } });
        bodyData = {
            "fields": {
                "description": jiraFormData[jiraFormData.Type].description,
                "issuetype": {
                    "name": jiraFormData.Type
                },
                "labels": [
                    jiraFormData.JIRA_AGILE_LABEL
                ],
                "priority": {
                    "name": jiraFormData[jiraFormData.Type].priority
                },
                "project": {
                    "key": jiraFormData.Project
                },
                "summary": jiraFormData[jiraFormData.Type].summary,
                "customfield_11890": parseInt(jiraFormData[jiraFormData.Type]["customfield_11890"]),
                "fixVersions": fixVersions,
                "customfield_12790": jiraFormData[jiraFormData.Type].customfield_12790,
                "customfield_21909": {
                    "value": jiraFormData[jiraFormData.Type].customfield_21909,
                },
                "customfield_28096": {
                    "value": jiraFormData[jiraFormData.Type].customfield_28096,
                },
                "assignee": {
                    "name": jiraFormData[jiraFormData.Type].assignee
                },
                "customfield_28101": {
                    "name": jiraFormData[jiraFormData.Type].customfield_28101
                },
                "customfield_26394": customfield_26394_values,
                "customfield_28102": {
                    "name": jiraFormData[jiraFormData.Type].customfield_28102
                },
                "customfield_28097": customfield_28097_values,
            },
            "update": {}
        };
    } else if (issueType == "Story Task") {
        let fixVersions = jiraFormData[issueType]["fixVersions"].map((version) => { return { "name": version } });
        let customfield_28097_values = jiraFormData[issueType]["customfield_28097"].map((entry) => { return { "name": entry } });
        bodyData = {
            "fields": {
                "description": jiraFormData[jiraFormData.Type].description,
                "issuetype": {
                    "name": jiraFormData.Type
                },
                "labels": [
                    jiraFormData.JIRA_AGILE_LABEL
                ],
                "parent": {
                    "key": jiraFormData[jiraFormData.Type].parent
                },
                "priority": {
                    "name": jiraFormData[jiraFormData.Type].priority
                },
                "project": {
                    "key": jiraFormData.Project
                },
                "summary": jiraFormData[jiraFormData.Type].summary,
                "customfield_28096": {
                    "value": jiraFormData[jiraFormData.Type].customfield_28096,
                },
                "assignee": {
                    "name": jiraFormData[jiraFormData.Type].assignee
                },
                "fixVersions": fixVersions,
                "customfield_28097": customfield_28097_values,
            },
            "update": {}
        };
    } else if (issueType == "Epic") {
        let fixVersions = jiraFormData[issueType]["fixVersions"].map((version) => { return { "name": version } });
        let customfield_26394_values = jiraFormData[issueType]["customfield_26394"].map((entry) => { return { "value": entry } });
        let customfield_28097_values = jiraFormData[issueType]["customfield_28097"].map((entry) => { return { "name": entry } });
        bodyData = {
            "fields": {
                "description": jiraFormData[jiraFormData.Type].description,
                "issuetype": {
                    "name": jiraFormData.Type
                },
                "labels": [
                    jiraFormData.JIRA_AGILE_LABEL
                ],
                "priority": {
                    "name": jiraFormData[jiraFormData.Type].priority
                },
                "project": {
                    "key": jiraFormData.Project
                },
                "summary": jiraFormData[jiraFormData.Type].summary,
                "customfield_12791": jiraFormData[jiraFormData.Type]["customfield_12791"],
                "fixVersions": fixVersions,
                "customfield_21909": {
                    "value": jiraFormData[jiraFormData.Type].customfield_21909,
                },
                "customfield_28096": {
                    "value": jiraFormData[jiraFormData.Type].customfield_28096,
                },
                "customfield_26394": customfield_26394_values,
                "assignee": {
                    "name": jiraFormData[jiraFormData.Type].assignee
                },
                "customfield_28097": customfield_28097_values,
            },
            "update": {
                "issuelinks": [
                    {
                        "add": {
                            "type": {
                                "name": 'Relates'
                            },
                            "outwardIssue": {
                                "key": jiraFormData[jiraFormData.Type].issuelinks
                            }
                        }
                    }
                ]
            }
        };
    }
    if (bodyData.fields.labels == "None") delete bodyData.fields.labels
    if (bodyData.fields.parent && !bodyData.fields.parent.key) delete bodyData.fields.parent.key
    try {
        let ret = await jira.addNewIssue(bodyData)
        if (ret.key) {
            response.status = 'success'
            response.key = ret.key
        } else {
            response.status = 'fail'
            response.error = 'unable to determine jira key after the update to JIRA'
        }
    } catch (e) {
        console.log(e)
        response.status = 'fail'
        response.error = `Unable to create issue in JIRA backend. Error: ${e.message}`
    }
    return response
}

async function getJiraRecordFromKey(key) {
    try {
        let issue = await jira.findIssue(key)
        let jiraRec = utils.getRecFromJiraIssue(issue)
        return jiraRec
    } catch (e) {
        return {}
    }
}

async function updateJiraRecInDb(dsName, selectorObj, jiraRec, jiraConfig) {
    let dbAbstraction = new DbAbstraction();
    let r;
    let response = {};
    if (!jiraConfig.jiraFieldMapping || !Object.keys(jiraConfig.jiraFieldMapping).length) {
        r = defaultJiraMapping(jiraRec, jiraConfig);
    } else {
        r = doJiraMapping(jiraRec, jiraConfig);
    }
    try {
        await dbAbstraction.update(dsName, "data", selectorObj, r.fullRec);
        response.status = 'success'
        response.record = r.fullRec
    } catch (e) {
        response.status = 'fail'
        response.error = 'unable to update the jiraRec in db'
        console.log("Db update error refreshJiraQuery: ", e);
    }
    await dbAbstraction.destroy();
    return response
}

function getFullRecFromJiraRec(jiraRec, jiraConfig) {
    let r;
    if (!jiraConfig.jiraFieldMapping || !Object.keys(jiraConfig.jiraFieldMapping).length) {
        r = defaultJiraMapping(jiraRec, jiraConfig);
    } else {
        r = doJiraMapping(jiraRec, jiraConfig);
    }
    return r
}

async function getJiraAgileJql(jiraConfig) {
    let jql;
    try {
        if (jiraConfig._id == "jiraAgileConfig") {
            let jiraConfiguration = await jira.getConfiguration(jiraConfig.boardId)
            let filterUrl = jiraConfiguration.filter.self;
            const auth = 'Basic ' + Buffer.from(JiraSettings.settings.username + ':' + JiraSettings.settings.password).toString('base64');
            const options = {
                headers: {
                    'Authorization': auth
                }
            };
            const response = await fetch(filterUrl, options);
            if (response.ok) {
                let responseJson = await response.json();
                jql = responseJson.jql
            }
        }
    } catch (e) {
        console.log("Error encountered while retreiving the jql for JIRA_AGILE config", e)
    }
    return jql
}

module.exports = {
    refreshJiraQuery,
    getProjectsMetaData,
    getDefaultTypeFieldsAndValues,
    createJiraIssue,
    getJiraRecordFromKey,
    updateJiraRecInDb,
    getFullRecFromJiraRec,
    createFilteredProjectsMetaData
};
