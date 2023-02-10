var JiraApi = require('jira-client');
const DbAbstraction = require('./dbAbstraction');
const JiraSettings = require('./jiraSettings');
const utils = require('./utils')
// Initialize

let host = JiraSettings.host;
var jira = new JiraApi(JiraSettings.settings);

// Custom fields per installation
let fields = ["summary", "assignee", "customfield_25901", "issuetype", "customfield_26397", "customfield_11504", "description", "priority", "reporter", "customfield_21091", "status", "customfield_25792", "customfield_25907", "customfield_25802", "created", "customfield_22013", "customfield_25582", "customfield_25588", "customfield_25791", "versions", "parent", "subtasks", "issuelinks", "updated", "votes", "customfield_25570", "labels", "customfield_25693", "customfield_25518", "customfield_12790", "customfield_11890", "customfield_11990"];

// Must have 'Work-id' and 'Description' fields in the data-set. 
// The keys for this dataset must include 'Work-id' for now. 
// 'Work-id' and 'Description' will get populated from Jira. 
// You can have additional rows and they won't get touched. 
// If you change 'Description', you'll lose it when it next updates. 
// Make it possible for users to specify the jql. 

async function refreshJiraQuery (dsName, jiraConfig) {
    let startAt = 0; let total = 0;
    let resultRecords = [];
    let names, results; 

    await markAsStale(dsName, jiraConfig);
    do {
        console.log("Fetching from: ", startAt);
        // Comment out 'fields' below for getting all fields for field exploration. 
        results = await jira.searchJira(jiraConfig.jql, { startAt, fields, expand: ["names"] } );
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
    let jiraKeyMapping = {'key': jiraFieldMapping['key']};
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
        if (!rec[key]) continue;
        if (!fullRec[jiraContentMapping[key]]) {
            if (revContentMap[jiraContentMapping[key]] > 1)
                fullRec[jiraContentMapping[key]] = `**${key}**: ${rec[key]}`;
            else 
                fullRec[jiraContentMapping[key]] = rec[key];
        } else {
            let ws = "<br>";
            let recValue = `**${key}**: ${rec[key]}`;
            fullRec[jiraContentMapping[key]] += ws + recValue;
        }
    }
    return { selectorObj, fullRec }
}

function defaultJiraMapping(rec, jiraConfig) {
    let jiraUrl = "https://" + host; 
    let jiraKeyMapping = {'key': 'Work-id'}
    // No need for "Details" links to appear here. 
    let jiraContentMapping = { 'summary': 'Description', 'type': 'Description', 'assignee': 'Description', 'severity': 'Description', 'priority': 'Description', 'foundInRls': 'Description', 'reporter': 'Description', 'created': 'Description', 'rrtTargetRls': 'Description', 'targetRls': 'Description', 'status': 'Description', 'feature': 'Description', 'rzFeature': 'Description', 'versions': 'Description', 'parentKey': 'Description', 'parentSummary': 'Description', 'parent': 'Description', 'subtasks': 'Description', 'labels': 'Description', 'phaseBugFound': 'Description', 'phaseBugIntroduced': 'Description', 'epic': 'Description', 'description': 'Description', 'estimate': 'Description', 'sprintNumber': 'Description' };
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

async function markAsStale (dsName, jiraConfig) {
    let jiraUrl = "https://" + host; 
    let jiraFieldMapping; 
    if (!jiraConfig.jiraFieldMapping || !Object.keys(jiraConfig.jiraFieldMapping).length) {
        // No need for "Details" links to appear here. 
        jiraFieldMapping = { 'key': 'Work-id', 'summary': 'Description', 'type': 'Description', 'assignee': 'Description', 'severity': 'Description', 'priority': 'Description', 'foundInRls': 'Description', 'reporter': 'Description', 'created': 'Description', 'rrtTargetRls': 'Description', 'targetRls': 'Description', 'status': 'Description', 'feature': 'Description', 'rzFeature': 'Description', 'versions': 'Description', 'parentKey': 'Description', 'parentSummary': 'Description', 'parent': 'Description', 'subtasks': 'Description', 'labels': 'Description', 'phaseBugFound': 'Description', 'phaseBugIntroduced': 'Description', 'epic': 'Description', 'description': 'Description', 'estimate': 'Description', 'sprintNumber': 'Description' };
    } else { 
        jiraFieldMapping = JSON.parse(JSON.stringify(jiraConfig.jiraFieldMapping));
    }
    let jiraKeyMapping = {'key': jiraFieldMapping['key']};
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
    } catch (e) {}
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
                if (/ENTRY NO LONGER PRESENT IN/.test(rec[jiraContentMapping['summary']])) {
                    alreadyStale = true;
                    continue;
                }
                jiraColumns[jiraContentMapping['summary']] = '[ENTRY NO LONGER PRESENT IN JIRA QUERY]{.y}\n\n' + rec[jiraContentMapping['summary']];

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
    } catch (e) {}
    await dbAbstraction.destroy();
}


function getSubTasksDetailsInTable (issue) {
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

// async function createJiraIssue(request) {
//     let bodyData = {
//         "fields": {
//             "issuetype": {
//                 "name": request.type
//             },
//             "summary": request.summary,
//             "priority": {
//                 "name": request.priority
//             },
//             "description": request.description,
//         }
//     }
//     try {
//         let ret = jira.addNewIssue(bodyData)
//         jira.deleteIssue
//     } catch (e) {
//         console.log(e)
//     }
// }

function getProjectsMetaData() {
    try {
        let filteredProjectsMetaData = {}
        let origProjectsMetaData = JiraSettings.projectsMetaData
        filteredProjectsMetaData.projects = []
        for (let i = 0; i < origProjectsMetaData.projects.length; i++) {
            let currOrigProjectMetaData = origProjectsMetaData.projects[i];
            let currFilteredProjectMetaData = {};
            currFilteredProjectMetaData.name = currOrigProjectMetaData.name
            currFilteredProjectMetaData.issuetypes = [];
            for (let j = 0; j < currOrigProjectMetaData.issuetypes.length; j++) {
                let currOrigProjectIssueTypeMetaData = currOrigProjectMetaData.issuetypes[j];
                let currFilteredProjectIssueTypeMetaData = {}
                currFilteredProjectIssueTypeMetaData.name = currOrigProjectIssueTypeMetaData.name
                currFilteredProjectIssueTypeMetaData.fields = {}
                for (let field of Object.keys(currOrigProjectIssueTypeMetaData.fields)) {
                    if (field == "project" || field == "issuetype") continue
                    let currOrigIssueTypeFieldObj = currOrigProjectIssueTypeMetaData.fields[field]
                    if (currOrigIssueTypeFieldObj.required || field == "description" || field == "priority" || field == "customfield_11890") {
                        currFilteredProjectIssueTypeMetaData.fields[field] = {}
                        currFilteredProjectIssueTypeMetaData.fields[field].required = currOrigIssueTypeFieldObj.required
                        currFilteredProjectIssueTypeMetaData.fields[field].type = currOrigIssueTypeFieldObj.schema.type
                        currFilteredProjectIssueTypeMetaData.fields[field].name = currOrigIssueTypeFieldObj.name
                        if (currFilteredProjectIssueTypeMetaData.fields[field].name == "Story Points") {
                            currFilteredProjectIssueTypeMetaData.fields[field].name = "estimate"
                        }
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
                }
                currFilteredProjectMetaData.issuetypes.push(currFilteredProjectIssueTypeMetaData)
            }
            filteredProjectsMetaData.projects.push(currFilteredProjectMetaData)
        }
        return filteredProjectsMetaData
    } catch (e) {
        console.log(e)
        return {}
    }
}

module.exports = {
    refreshJiraQuery,
    getProjectsMetaData
};