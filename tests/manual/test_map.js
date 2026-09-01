require('dotenv').config();
const axios = require('axios');
function extractAdfText(body) {
    if (!body) return '';
    if (typeof body === 'string') return body;
    try {
        const parts = [];
        const walk = n => { if (n.text) parts.push(n.text); (n.content||[]).forEach(walk); };
        walk(body);
        return parts.join(' ');
    } catch(e) { return ''; }
}

async function t(){
  try {
    const email = "rabasurco@stefanini.com";
    const jql = `project = INC AND reporter = "${email}" AND created >= -30d ORDER BY created DESC`;
    const auth = Buffer.from(process.env.JIRA_EMAIL+':'+process.env.JIRA_API_TOKEN).toString('base64');
    const r = await axios.get('https://integratelperu.atlassian.net/rest/api/3/search/jql?jql='+encodeURIComponent(jql)+'&maxResults=100&fields=summary,status,priority,comment,created,components', {headers:{Authorization:'Basic '+auth, Accept:'application/json'}});
    
    let data = (r.data.issues || []).map(i => {
        const f          = i.fields;
        const jiraStatus = f.status?.name || 'Abierto';
        const comments   = f.comment?.comments || [];
        const lastCmt    = comments.length ? comments[comments.length - 1] : null;
        const component  = (f.components || [])[0]?.name || null;
        return {
            id:            i.key,
            titulo:        f.summary,
            lastComment:   lastCmt ? extractAdfText(lastCmt.body) : null,
        };
    });
    console.log('MAPPED:', data.length, data);
  } catch(e){
    console.error('ERR:', e.message);
  }
}
t();
