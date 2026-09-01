require('dotenv').config();
const axios=require('axios');
async function test(){
  const t=Buffer.from(process.env.JIRA_EMAIL+':'+process.env.JIRA_API_TOKEN).toString('base64');
  try{
    const jql='project = INC AND reporter = "rabasurco@stefanini.com" ORDER BY created DESC';
    const r = await axios.get('https://integratelperu.atlassian.net/rest/api/3/search/jql?jql='+encodeURIComponent(jql)+'&maxResults=100&fields=summary,status,priority,comment,created,components', {headers:{Authorization:'Basic '+t, Accept:'application/json'}});
    console.log(r.data.issues.length);
  } catch(e){
    console.error('ERR:', e.message, e.response?.data);
  }
}
test();
