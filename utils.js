const exec = require('child_process').exec;
const fs = require("fs")
const path = require("path")

const JiraSettings = require('./jiraSettings');
let host = JiraSettings.host;

/**
 * Look ma, it's cp -R.
 * @param {string} src  The path to the thing to copy.
 * @param {string} dest The path to the new copy.
 */
var copyRecursiveSync = function(src, dest) {
  var exists = fs.existsSync(src);
  var stats = exists && fs.statSync(src);
  var isDirectory = exists && stats.isDirectory();
  if (isDirectory) {
    try {
        fs.mkdirSync(dest);
    } catch (e) {};
    fs.readdirSync(src).forEach(function(childItemName) {
      copyRecursiveSync(path.join(src, childItemName),
                        path.join(dest, childItemName));
    });
  } else if (exists) {
    fs.copyFileSync(src, dest);
  }
};


async function execCmdExecutor (cmdStr, maxBuffer = 1024 * 1024 * 10) {
    let p, f;
    exec(cmdStr, { maxBuffer: maxBuffer }, (error, stdout, stderr) => {
        if (error) {
            //console.log(`\n${Date()}: execCmdExecutor failed!: ${cmdStr}: ${error}\n`);
            //throw error;
            //XXX: need to send error alert in a better way
            //console.log(stdout);
            f("err");
            return;
        }
        f(stdout);
    });
    p = new Promise((resolve, reject) => {
        f = (ret) => {
            resolve(ret);
        };
    });
    return p;
}

function getRecFromJiraIssue(issue) {
  let jiraUrl = "https://" + host;
  let rec = {};
  rec.key = issue.key;
  rec.summary = issue.fields.summary;
  rec.type = issue.fields.issuetype.name;
  rec.jiraSummary = `${rec.summary}\n(${rec.key})`
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
    rec['Story Points'] = issue.fields.customfield_11890
  } else {
    rec['Story Points'] = 0
  }
  if (issue.fields.customfield_11990) {
    let sprintDetails = issue.fields.customfield_11990[0]
    let sprintNameMatchArr = sprintDetails.match(/name=([^,]*)/)
    if (sprintNameMatchArr && sprintNameMatchArr.length >= 2) {
      rec.sprintName = sprintNameMatchArr[1]
    } else {
      rec.sprintName = ""
    }
  } else {
    rec.sprintName = ""
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
  return rec
}

function getSubTasksDetailsInList(issue) {
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

function getIssueLinksInList(issueLinks, type, dir) {
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
      details += ", ";
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
    execCmdExecutor,
  copyRecursiveSync,
  getRecFromJiraIssue
};