require('dotenv').config();
const axios = require('axios');
async function t(){
  try {
    const email = "rabasurco@stefanini.com";
    const jql = `project = INC AND reporter = "${email}" AND created >= -30d ORDER BY created DESC`;
    const r = await axios({
        method: 'GET',
        url: 'https://integratelperu.atlassian.net/rest/api/3/search/jql?jql='+encodeURIComponent(jql)+'&maxResults=100&fields=summary,status,priority,comment,created,components',
        auth: { username: process.env.JIRA_EMAIL, password: process.env.JIRA_API_TOKEN },
        headers: { Accept: 'application/json' }
    });
    console.log('OK, count=', r.data.issues.length);
  } catch(e){
    console.error('ERR:', e.response ? e.response.status : e.message, e.response ? e.response.data : '');
  }
}
t();
