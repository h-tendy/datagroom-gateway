const DbAbstraction = require('./dbAbstraction');
const jwt = require('jsonwebtoken');
const Utils = require('./utils');
const logger = require('./logger');

async function aclCheck(dsName, dsView, dsUser, token = null, authMethod = 'jwt') {
    let dbAbstraction = new DbAbstraction();
    try {
        let aclConfig = await dbAbstraction.find(dsName, "metaData", { _id: "aclConfig" }, {});
        aclConfig = aclConfig[0];
        if (!aclConfig) {
            return true;
        }
        if (!aclConfig.accessCtrl) {
            return true;
        }
        logger.info(`ACL check for user: ${dsUser}, authMethod: ${authMethod}, dataset: ${dsName}`);

        if (authMethod === 'pat' && dsUser) {
            if (aclConfig.acl && aclConfig.acl.includes(dsUser)) {
                logger.info(`User ${dsUser} granted access via PAT (dataset: ${dsName})`);
                return true;
            }
            logger.warn(`User ${dsUser} denied access via PAT (dataset: ${dsName})`);
            return false;
        }

        if (token) {
            try {
                const decode = jwt.verify(token, Utils.jwtSecret);
                dsUser = decode.user;
                if (aclConfig.acl && aclConfig.acl.includes(dsUser)) {
                    logger.info(`User ${dsUser} granted access via JWT (dataset: ${dsName})`);
                    return true;
                }
                logger.warn(`User ${dsUser} denied access via JWT (dataset: ${dsName})`);
            } catch (e) {
                logger.error(e, "Error verifying token in aclcheck");
            }
        } else {
            logger.warn("Got no token in acl check");
        }
    } catch (e) {
        logger.error(e, "Exception in aclCheck");
    }
    return false;
}

module.exports = {
    aclCheck
};