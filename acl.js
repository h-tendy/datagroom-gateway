const DbAbstraction = require('./dbAbstraction');

async function aclCheck (dsName, dsView, dsUser) {
    try {
        let dbAbstraction = new DbAbstraction();
        let aclConfig = await dbAbstraction.find(dsName, "metaData", { _id: `aclConfig` }, {} );
        aclConfig = aclConfig[0];
        if (!aclConfig) {
            await dbAbstraction.destroy();            
            return true
        }
        if (!aclConfig.accessCtrl) {
            await dbAbstraction.destroy();
            return true
        }
        console.log("User is: ", dsUser);
        if (aclConfig.acl.includes(dsUser)) {
            await dbAbstraction.destroy();
            return true
        }
    } catch (e) {
        console.log("In aclCheck, exception: ", e);
    }
    await dbAbstraction.destroy();
    return false;
}

module.exports = {
    aclCheck
};