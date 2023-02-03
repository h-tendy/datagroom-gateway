var JiraApi = require('jira-client');
const DbAbstraction = require('./dbAbstraction');
const JiraSettings = require('./jiraSettings');
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
    let jiraUrl = "https://" + host; 

    await markAsStale(dsName, jiraConfig);
    do {
        console.log("Fetching from: ", startAt);
        // Comment out 'fields' below for getting all fields for field exploration. 
        results = await jira.searchJira(jiraConfig.jql, { startAt, fields, expand: ["names"] } );
        startAt += results.issues.length;
        names = results.names;
        for (let i = 0; i < results.issues.length; i++) {
            let rec = {};
            let issue = results.issues[i];
            rec.key = issue.key;
            rec.summary = issue.fields.summary;
            rec.type = issue.fields.issuetype.name;
            rec.assignee = issue.fields.assignee ? issue.fields.assignee.name : "NotSet";
            rec.status = issue.fields.status.name;
            rec.priority = issue.fields.priority.name;
            rec.reporter = issue.fields.reporter.name;
            if (issue.fields.votes)
                rec.votes = issue.fields.votes.votes;
            rec.updated = issue.fields.updated.split('T')[0];
            if (issue.fields.customfield_25570)
                rec.systemFeature = issue.fields.customfield_25570.value;
            else 
                rec.systemFeature = "NotSet";            
            if (issue.fields.customfield_11504)
                rec.severity = issue.fields.customfield_11504.value;
            else 
                rec.severity = "NotSet";
            // This is an idiosyncracy in our jira installation
            if (rec.type === 'Feature')
                rec.severity = '';
            if (issue.fields.customfield_25802)
                rec.foundInRls = issue.fields.customfield_25802.value;
            else 
                rec.foundInRls = "NotSet";
            rec.created = issue.fields.created.split('T')[0];
            if (issue.fields.customfield_25907)
                rec.rrtTargetRls = issue.fields.customfield_25907.value;
            else 
                rec.rrtTargetRls = "NotSet";
            if (issue.fields.customfield_22013)
                rec.targetRls = issue.fields.customfield_22013.name;
            else 
                rec.targetRls = "NotSet";
            if (issue.fields.customfield_25588)
                rec.feature = issue.fields.customfield_25588.value;
            else 
                rec.feature = "NotSet";
            if (issue.fields.customfield_25791)
                rec.rzFeature = issue.fields.customfield_25791.value;
            else 
                rec.rzFeature = "NotSet";
            if (issue.fields.customfield_25693)
                rec.phaseBugIntroduced = issue.fields.customfield_25693.value;
            else 
                rec.phaseBugIntroduced = "NotSet";
            if (issue.fields.customfield_25518)
                rec.phaseBugFound = issue.fields.customfield_25518.value;
            else 
                rec.phaseBugFound = "NotSet";
            if (issue.fields.labels && issue.fields.labels.length) {
                rec.labels = ""; 
                for (let i = 0; i < issue.fields.labels.length; i++) {
                    rec.labels += issue.fields.labels[i];
                    if (i + 1 < issue.fields.labels.length) rec.labels += ', '
                }
            }
            if (issue.fields.versions && issue.fields.versions.length) {
                rec.versions = ""; 
                for (let i = 0; i < issue.fields.versions.length; i++) {
                    rec.versions += issue.fields.versions[i].name + ' ';
                }
            }
            if (issue.fields.parent) {
                rec.parentKey = `[${issue.fields.parent.key}](${jiraUrl + '/browse/' + issue.fields.parent.key})`
                try {
                    if (issue.fields.parent.fields.summary) {
                        rec.parentSummary = `${issue.fields.parent.fields.summary}`
                    } else {
                        rec.parentSummary = ""
                    }
                } catch (e) { rec.parentSummary = "" }
            } else {
                rec.parentKey = "";
                rec.parentSummary = ""
            }
            if (rec.parentKey != "") {
                if (rec.parentSummary != "") {
                    rec.parent = `${rec.parentKey} (${rec.parentSummary})`
                } else {
                    rec.parent = `${rec.parentKey}`
                }
            } else {
                rec.parent = ""
            }
            if (issue.fields.customfield_12790) {
                rec.epic = `[${issue.fields.customfield_12790}](${jiraUrl + '/browse/' + issue.fields.customfield_12790})`
            } else {
                rec.epic = ""
            }
            if (issue.fields.description)
                rec.description = issue.fields.description;
            else
                rec.description = "";
            if (issue.fields.customfield_11890) {
                rec.estimate = issue.fields.customfield_11890
            } else {
                rec.estimate = 0
            }
            if (issue.fields.customfield_11990) {
                let sprintDetails = issue.fields.customfield_11990[0]
                let sprintNumMatchArr = sprintDetails.match(/name=.*Sprint\s*(\d)+?/)
                if (sprintNumMatchArr && sprintNumMatchArr.length >= 2) {
                    rec.sprintNumber = parseInt(sprintNumMatchArr[1])
                } else {
                    rec.sprintNumber = 0
                }
            } else {
                rec.sprintNumber = 0
            }
            if (issue.fields.subtasks && issue.fields.subtasks.length) {
                rec.subtasks = "[";
                for (let i = 0; i < issue.fields.subtasks.length; i++) {
                    rec.subtasks += issue.fields.subtasks[i].key;
                    if (i + 1 < issue.fields.subtasks.length)
                        rec.subtasks += ", ";
                }
                rec.subtasks += "]";
            }
            if (issue.fields.subtasks && issue.fields.subtasks.length) {
                //rec.subtasksDetails = getSubTasksDetailsInTable(issue);
                rec.subtasksDetails = getSubTasksDetailsInList(issue);
            }
            if (issue.fields.issuelinks && issue.fields.issuelinks.length) {
                let name, details;

                // Depends links
                let dependsLinks = "";
                [name, details] = getIssueLinksInList(issue.fields.issuelinks, "Depends", "inward");
                if (name) {
                    dependsLinks += details;
                }
                [name, details] = getIssueLinksInList(issue.fields.issuelinks, "Depends", "outward");
                if (name) {
                    dependsLinks += details;
                }
                if (dependsLinks !== "") 
                    rec.dependsLinks = dependsLinks;

                // Implement links
                let implementLinks = "";
                [name, details] = getIssueLinksInList(issue.fields.issuelinks, "Implement", "inward");
                if (name) {
                    implementLinks += details;
                }
                [name, details] = getIssueLinksInList(issue.fields.issuelinks, "Implement", "outward");
                if (name) {
                    implementLinks += details;
                }
                if (implementLinks !== "") 
                    rec.implementLinks = implementLinks;

                // Package links
                let packageLinks = "";
                [name, details] = getIssueLinksInList(issue.fields.issuelinks, "Package", "inward");
                if (name) {
                    packageLinks += details;
                }
                [name, details] = getIssueLinksInList(issue.fields.issuelinks, "Package", "outward");
                if (name) {
                    packageLinks += details;
                }
                if (packageLinks !== "") 
                    rec.packageLinks = packageLinks;


                // Relates links
                let relatesLinks = "";
                [name, details] = getIssueLinksInList(issue.fields.issuelinks, "Relates", "inward");
                if (name) {
                    relatesLinks += details;
                }
                [name, details] = getIssueLinksInList(issue.fields.issuelinks, "Relates", "outward");
                if (name) {
                    relatesLinks += details;
                }
                if (relatesLinks !== "") 
                    rec.relatesLinks = relatesLinks;


                // Test links
                let testLinks = "";
                [name, details] = getIssueLinksInList(issue.fields.issuelinks, "Test", "inward");
                if (name) {
                    testLinks += details;
                }
                [name, details] = getIssueLinksInList(issue.fields.issuelinks, "Test", "outward");
                if (name) {
                    testLinks += details;
                }
                if (testLinks !== "") 
                    rec.testLinks = testLinks;


                // Covers links
                let coversLinks = "";
                [name, details] = getIssueLinksInList(issue.fields.issuelinks, "Covers", "inward");
                if (name) {
                    coversLinks += details;
                }
                [name, details] = getIssueLinksInList(issue.fields.issuelinks, "Covers", "outward");
                if (name) {
                    coversLinks += details;
                }
                if (coversLinks !== "") 
                    rec.coversLinks = coversLinks;


                // Defect links
                let defectLinks = "";
                [name, details] = getIssueLinksInList(issue.fields.issuelinks, "Defect", "inward");
                if (name) {
                    defectLinks += details;
                }
                [name, details] = getIssueLinksInList(issue.fields.issuelinks, "Defect", "outward");
                if (name) {
                    defectLinks += details;
                }
                if (defectLinks !== "") 
                    rec.defectLinks = defectLinks;


                // Automates links
                let automatesLinks = "";
                [name, details] = getIssueLinksInList(issue.fields.issuelinks, "Automates", "inward");
                if (name) {
                    automatesLinks += details;
                }
                [name, details] = getIssueLinksInList(issue.fields.issuelinks, "Automates", "outward");
                if (name) {
                    automatesLinks += details;
                }
                if (automatesLinks !== "") 
                    rec.automatesLinks = automatesLinks;

            }
             // Use this for new field explorations.
            if (issue.fields.customfield_25588) {
                console.log("\n\n\nGOT a non-null: ", issue.fields.customfield_25588);
                console.log("\n\n\n");
            }
            
            if (i == 0 ) { 
            //if (true) {
                console.log(JSON.stringify(issue, null, 4));
                console.log("Do figure out jira names: ", names)
            }
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

function getSubTasksDetailsInList (issue) {
    let jiraUrl = "https://" + host; 
    let subtasksDetails = "\n";
    if (issue.fields.subtasks && issue.fields.subtasks.length) {
        for (let i = 0; i < issue.fields.subtasks.length; i++) {
            subtasksDetails += "1. [";
            //subtasksDetails += issue.fields.subtasks[i].key + ", ";
            subtasksDetails += `[${issue.fields.subtasks[i].key}](${jiraUrl + '/browse/' + issue.fields.subtasks[i].key}), `;
            if (issue.fields.subtasks[i].fields.issuetype)
                subtasksDetails += issue.fields.subtasks[i].fields.issuetype.name + ", ";
            else 
                subtasksDetails += ", ";
            //subtasksDetails += `<span style="color: ${issue.fields.subtasks[i].fields.status.statusCategory.colorName}; background-color: lightgrey">${issue.fields.subtasks[i].fields.status.name}</span>` + ", ";
            if (issue.fields.subtasks[i].fields.status)
                subtasksDetails += issue.fields.subtasks[i].fields.status.name + ", ";
            else 
                subtasksDetails += ", ";
            if (issue.fields.subtasks[i].fields.priority)
                subtasksDetails += issue.fields.subtasks[i].fields.priority.name + "] ";
            else 
                subtasksDetails += ", ";
            subtasksDetails += issue.fields.subtasks[i].fields.summary + "\n";
        }
    }
    return subtasksDetails + "\n";
}

function getIssueLinksInList (issueLinks, type, dir) {
    let jiraUrl = "https://" + host; 
    let details = "\n"; let dirName = "";
    for (let i = 0; i < issueLinks.length; i++) {
        if (issueLinks[i].type.name !== type)
            continue;
        if (dir == "inward" && !issueLinks[i].inwardIssue)
            continue;
        if (dir == "outward" && !issueLinks[i].outwardIssue)
            continue;
        let issue = null;
        if (dir == "inward") {
            dirName = issueLinks[i].type.inward;
            issue = issueLinks[i].inwardIssue;
        } else {
            dirName = issueLinks[i].type.outward;
            issue = issueLinks[i].outwardIssue;
        }
        details += "1. [";
        details += `[${issue.key}](${jiraUrl + '/browse/' + issue.key}), `;
        if (issue.fields.issuetype)
            details += issue.fields.issuetype.name + ", ";
        else 
            detail += ", ";
        if (issue.fields.status)
            details += issue.fields.status.name + ", ";
        else 
            details += ", ";
        if (issue.fields.priority)
            details += issue.fields.priority.name + "] ";
        else 
            details += ", ";
        details += issue.fields.summary + "\n";
    }
    if (details == "\n") {
        details = "";
    } else {
        details = `<u>${dirName}</u>` + ":\n" + details + '\n\n';
    }
    return [dirName, details];
}

module.exports = {
    refreshJiraQuery
};