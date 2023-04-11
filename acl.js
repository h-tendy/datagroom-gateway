const DbAbstraction = require('./dbAbstraction');
const jwt = require('jsonwebtoken');
const Utils = require('./utils');

async function aclCheck(dsName, dsView, dsUser, token = null) {
    let dbAbstraction = new DbAbstraction();
    try {
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
        if (token) {
            try {
                const decode = jwt.verify(token, Utils.jwtSecret)
                dsUser = decode.user;
                if (aclConfig.acl.includes(dsUser)) {
                    await dbAbstraction.destroy();
                    return true
                } else {
                    console.log(`User ${dsUser} does not have access`)
                }
            } catch (e) {
                console.log("Error verifying token");
            }
        } else {
            console.log("Got no token in acl check")
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