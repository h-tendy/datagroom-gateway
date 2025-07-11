const DbAbstraction = require('./dbAbstraction');
const jwt = require('jsonwebtoken');
const Utils = require('./utils');
const logger = require('./logger');

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
        logger.info(`User is: , ${dsUser} in aclCheck`);
        if (token) {
            try {
                const decode = jwt.verify(token, Utils.jwtSecret)
                dsUser = decode.user;
                if (aclConfig.acl.includes(dsUser)) {
                    await dbAbstraction.destroy();
                    return true
                } else {
                    logger.warn(`User ${dsUser} does not have access`);
                }
            } catch (e) {
                logger.error(e, "Error verifying token in aclcheck");
            }
        } else {
            logger.warn("Got no token in acl check");
        }
    } catch (e) {
        logger.error(e, "Exception in aclCheck");
    }
    await dbAbstraction.destroy();
    return false;
}

module.exports = {
    aclCheck
};