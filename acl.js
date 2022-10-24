const DbAbstraction = require('./dbAbstraction');

async function aclCheck (dsName, dsView, dsUser) {
    try {
        let dbAbstraction = new DbAbstraction();
        let aclConfig = await dbAbstraction.find(dsName, "metaData", { _id: `aclConfig` }, {} );
        aclConfig = aclConfig[0];
        console.log("In aclCheck, aclConfig: ", aclConfig);
        if (!aclConfig) {
            return true
        }
        if (!aclConfig.accessCtrl) {
            console.log("Returning true");
            return true
        }
        console.log("User is: ", dsUser);
        if (aclConfig.acl.includes(dsUser)) {
            console.log("Returning true 2");
            return true
        }
    } catch (e) {
        console.log("In aclCheck, exception: ", e);
    }
    console.log("Returning false")
    return false;
}

module.exports = {
    aclCheck
};