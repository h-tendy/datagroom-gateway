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

async function refreshJiraQuery (dsName, jql) {
    let startAt = 0; let total = 0;
    let resultRecords = [];
    let jiraUrl = "https://" + host; 
    let names, results;
    do {
        console.log("Fetching from: ", startAt);
        results = await jira.searchJira(jql, { startAt, fields, expand: ["names"] } );
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
    let jiraContentMapping = {'summary' : 'Description', 'type' : 'Description', 'assignee' : 'Description', 'severity': 'Description', 'priority': 'Description', 'foundInRls': 'Description', 'created': 'Description', 'rrtTargetRls': 'Description', 'status' : 'Description'};
    for (let i = 0; i < resultRecords.length; i++) {
        let rec = resultRecords[i];
        let selectorObj = {}, fullRec = {};
        /*
        for (let j = 0; j < keys.length; j++) {
            let key = keys[j]
            selectorObj[key] = `[${rec[keysMapping[key]]}](${jiraUrl + '/browse/' + rec[keysMapping[key]]})`;
            fullRec[key] = `[${rec[keysMapping[key]]}](${jiraUrl + '/browse/' + rec[keysMapping[key]]})`;
        } */
        selectorObj['Work-id'] = `[${rec.key}](${jiraUrl + '/browse/' + rec.key})`;
        fullRec['Work-id'] = `[${rec.key}](${jiraUrl + '/browse/' + rec.key})`;

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
        console.log("selectorObj: ", selectorObj);
        console.log("FullRec: ", fullRec);
        try {
            await dbAbstraction.update(dsName, "data", selectorObj, fullRec);
        } catch (e) {
            console.log("Db update error: ", e);
        }
        //console.log(rec.key, rec.summary);
        //console.log("    ", rec.type, `"${rec.assignee}"`, `"${rec.status}"`);
    }
    /*
    console.log(names);
    for (let key in names) {
        if (names[key] === "DayOpened") console.log(key, names[key]);
    }*/
}

module.exports = {
    refreshJiraQuery
};