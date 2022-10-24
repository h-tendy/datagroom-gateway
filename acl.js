const DbAbstraction = require('./dbAbstraction');

async function aclCheck (dsName, dsView, dsUser) {
    try {
        let dbAbstraction = new DbAbstraction();
        let aclConfig = await dbAbstraction.find(dsName, "metaData", { _id: `aclConfig` }, {} );
        aclConfig = aclConfig[0];
        if (!aclConfig) {
            return true
        }
        if (!aclConfig.accessCtrl) {
            return true
        }
        console.log("User is: ", dsUser);
        if (aclConfig.acl.includes(dsUser)) {
            return true
        }
    } catch (e) {
        console.log("In aclCheck, exception: ", e);
    }
    return false;
}

module.exports = {
    aclCheck
};