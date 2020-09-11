

let ldapOps = {
    server: {
        url: 'ldap://ldapserver:389',
        bindDn: 'CN=something,OU=Service Accounts,OU=GroupAccounts,DC=mycompany,DC=com',
        bindCredentials: 'user@mycompany',
        searchBase: 'OU=CorpUsers,DC=mycompany,DC=com',
        searchFilter: '(sAMAccountName={{username}})'
    }
}

module.exports = ldapOps
