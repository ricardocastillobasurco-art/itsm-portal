
const express = require('express');
const router = express.Router();

require('./migrations')();
require('./cron')();

router.use('/', require('./portal'));
router.use('/', require('./tickets_local'));
router.use('/', require('./tickets_jira'));
router.use('/', require('./requirements'));
router.use('/', require('./admin'));
router.use('/', require('./reports'));
router.use('/', require('./local_panels'));
router.use('/', require('./attachments'));
router.use('/', require('./config_itsm'));
if (require('fs').existsSync(require('path').join(__dirname, 'other.js'))) {
    router.use('/', require('./other'));
}

module.exports = router;
    
