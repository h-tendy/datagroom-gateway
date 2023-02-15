let host = 'jira.yourcompany.com'
let settings = {
    protocol: 'https',
    host,
    username: 'user',
    password: 'password',
    apiVersion: '2',
    strictSSL: false
}

let defaultTypeFieldsAndValues = {
    "projects": [
        {
            "key": "THANOS",
            "issuetypes": {
                "Bug": {
                    "summary": "",
                    "description": "",
                    "priority": "Medium",
                    "versions": ["1.0", "2.0"],
                    "customfield_25555": ["2.0"],
                    "customfield_25518": "Development",
                    "assignee": ""
                },
                "Story": {
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
        },
    ]
}

let jiraMetaDataRefreshIntervalInMs = 1 * 24 * 60 * 60 * 1000; // 1 day

module.exports = {
    host,
    settings,
    defaultTypeFieldsAndValues,
    jiraMetaDataRefreshIntervalInMs
}