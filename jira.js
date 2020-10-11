var JiraApi = require('jira-client');
const DbAbstraction = require('./dbAbstraction');
const JiraSettings = require('./jiraSettings');
// Initialize

let host = JiraSettings.host;
var jira = new JiraApi(JiraSettings.settings);

// Custom fields per installation
let fields = ["summary", "assignee", "customfield_25901", "issuetype", "customfield_26397", "customfield_11504", "description", "priority", "reporter", "customfield_21091", "status", "customfield_25792", "customfield_25907", "customfield_25802", "created"];

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
        results = await jira.searchJira(jiraConfig.jql, { startAt, fields, expand: ["names"] } );
        startAt += results.issues.length;
        names = results.names;
        for (let i = 0; i < results.issues.length; i++) {
            let rec = {};
            let issue = results.issues[i];
            rec.key = issue.key;
            rec.summary = issue.fields.summary;
            rec.type = issue.fields.issuetype.name;
            rec.assignee = issue.fields.assignee.name;
            rec.status = issue.fields.status.name;
            rec.priority = issue.fields.priority.name;
            rec.reporter = issue.fields.reporter.name;
            if (issue.fields.customfield_11504)
                rec.severity = issue.fields.customfield_11504.value;
            else 
                rec.severity = "NotSet";
            if (issue.fields.customfield_25802)
                rec.foundInRls = issue.fields.customfield_25802.value;
            else 
                rec.foundInRls = "NotSet";
            rec.created = issue.fields.created.split('T')[0];
            if (issue.fields.customfield_25907)
                rec.rrtTargetRls = issue.fields.customfield_25907.value;
            else 
                rec.rrtTargetRls = "NotSet";
            if (i == 0 ) console.log(issue);
            resultRecords.push(rec);
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
            r = defaultJiraMapping(rec);
        } else {
            r = doJiraMapping(rec, jiraConfig.jiraFieldMapping);
        }
        console.log("selectorObj: ", r.selectorObj);
        console.log("FullRec: ", r.fullRec);
        try {
            await dbAbstraction.update(dsName, "data", r.selectorObj, r.fullRec);
        } catch (e) {
            console.log("Db update error refreshJiraQuery: ", e);
        }
    }
}

function doJiraMapping (rec, jiraFieldMapping) {
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
    selectorObj[jiraKeyMapping['key']] = `[${rec.key}](${jiraUrl + '/browse/' + rec.key})`;
    //selectorObj[jiraKeyMapping['key']] = {$regex: `${rec.key}$`, $options: 'i'};
    fullRec[jiraKeyMapping['key']] = `[${rec.key}](${jiraUrl + '/browse/' + rec.key})`;

    for (let key in jiraContentMapping) {
        if (!fullRec[jiraContentMapping[key]]) {
            if (revContentMap[jiraContentMapping[key]] > 1)
                fullRec[jiraContentMapping[key]] = `**${key}**: ${rec[key]}`;
            else 
                fullRec[jiraContentMapping[key]] = rec[key];
        } else {
            let ws = " ";
            let recValue = `**${key}**: ${rec[key]}`;
            fullRec[jiraContentMapping[key]] += ws + recValue;
        }
    }
    return { selectorObj, fullRec }
}

function defaultJiraMapping (rec) {
    let jiraUrl = "https://" + host; 
    let jiraKeyMapping = {'key': 'Work-id'}
    let jiraContentMapping = {'summary' : 'Description', 'type' : 'Description', 'assignee' : 'Description', 'severity': 'Description', 'priority': 'Description', 'foundInRls': 'Description', 'reporter': 'Description', 'created': 'Description', 'rrtTargetRls': 'Description', 'status' : 'Description'};
    let selectorObj = {}, fullRec = {};
    selectorObj[jiraKeyMapping['key']] = `[${rec.key}](${jiraUrl + '/browse/' + rec.key})`;
    fullRec[jiraKeyMapping['key']] = `[${rec.key}](${jiraUrl + '/browse/' + rec.key})`;

    for (key in jiraContentMapping) {
        recValue = `**${key}**: ${rec[key]}`;
        if (!fullRec[jiraContentMapping[key]]) {
            fullRec[jiraContentMapping[key]] = recValue;
        } else {
            let ws = " ";
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
        jiraFieldMapping = {'key': 'Work-id', 'summary' : 'Description', 'type' : 'Description', 'assignee' : 'Description', 'severity': 'Description', 'priority': 'Description', 'foundInRls': 'Description', 'reporter': 'Description', 'created': 'Description', 'rrtTargetRls': 'Description', 'status' : 'Description'};
    } else { 
        jiraFieldMapping = JSON.parse(JSON.stringify(jiraConfig.jiraFieldMapping));
    }
    let jiraKeyMapping = {'key': jiraFieldMapping['key']};
    delete jiraFieldMapping.key;
    let jiraContentMapping = jiraFieldMapping;

    let filters = {}; sorters = [];
    try {
        filters[jiraKeyMapping['key']] = {$regex: `${jiraUrl + '/browse/'}`, $options: 'i'};
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
                for (let jiraKey in jiraContentMapping) {
                    if (/ENTRY NO LONGER PRESENT IN/.test(rec[jiraContentMapping[jiraKey]])) {
                        alreadyStale = true;
                        break;
                    }
                    jiraColumns[jiraContentMapping[jiraKey]] = '[ENTRY NO LONGER PRESENT IN JIRA QUERY]{.y}\n\n' + rec[jiraContentMapping[jiraKey]];
                }
                if (alreadyStale) continue;
                try {
                    await dbAbstraction.update(dsName, "data", selectorObj, jiraColumns);
                } catch (e) {
                    console.log("Db update error in markAsStale : ", e);
                }
            }
        } while (page <= response.total_pages)
    } catch (e) {}
}


module.exports = {
    refreshJiraQuery
};