require('dotenv').config();
const axios = require('axios');
async function t(){
  try {
    const email = "rabasurco@stefanini.com";
    const jql = `project = INC AND reporter = "${email}" AND created >= -30d ORDER BY created DESC`;
    const auth = Buffer.from(process.env.JIRA_EMAIL+':'+process.env.JIRA_API_TOKEN).toString('base64');
    const r = await axios.get('https://integratelperu.atlassian.net/rest/api/3/search/jql?jql='+encodeURIComponent(jql)+'&maxResults=100&fields=summary,status,priority,comment,created,components', {headers:{Authorization:'Basic '+auth, Accept:'application/json'}});
    console.log('OK, count=', r.data.issues.length);
  } catch(e){
    console.error('ERR:', e.response ? e.response.status : e.message, e.response ? e.response.data : '');
  }
}
t();
