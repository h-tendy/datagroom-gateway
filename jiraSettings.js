let host = 'jira.yourcompany.com'
let settings = {
    protocol: 'https',
    host,
    username: 'user',
    password: 'password',
    apiVersion: '2',
    strictSSL: false
}

/**
 * Make an api call to https://<host>/rest/api/2/issue/createmeta?projectKeys=<project-key>&issuetypes=Bug&expand=projects.issuetypes.fields
 * and populate the object here in the projectsMetaData field
 */

let projectsMetaData = {}

/**
 * For a given project above, for each issueType, give the fields and the default values in the following format.
 * If the type is string, give it like summary. If the type is array, enclose the values in array. If the type is
 * option, then a single string. If the type is number, give the number value.
 * Below, is the sample format. Currently supported issueTypes are Bug, User Story, Epic, Sub-task. To be extended in future.
 */

let defaultTypeFieldsAndValues = {
    "Bug": {
        "summary": "",
        "description": "",
        "priority": "Medium",
        "versions": ["1.0", "2.0"],
        "customfield_25555": ["2.0"],
        "customfield_25518": "Development",
        "assignee": ""
    },
    "User Story": {
        "summary": "",
        "description": "",
        "priority": "Medium",
        "customfield_11890": 0,
        "fixVersions": ["2.0"]
    },
    "Sub-task": {
        "summary": "",
        "priority": "Medium",
        "customfield_11890": 0,
        "parent": ""
    },
    "Epic": {
        "summary": "",
        "description": "",
        "priority": "Medium",
        "customfield_12791": "",
    }
}

module.exports = {
    host,
    settings,
    projectsMetaData,
    defaultTypeFieldsAndValues
}