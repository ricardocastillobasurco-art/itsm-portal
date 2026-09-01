const seq = require('./src/config/database');
const { QueryTypes } = require('sequelize');
Promise.all([
  seq.query("SELECT COUNT(*) as n FROM ticket_history WHERE detalle LIKE '%presencial%'", {type:QueryTypes.SELECT}),
  seq.query("SELECT COUNT(*) as n FROM ticket_history WHERE evento='cierre' AND detalle LIKE '%remota%'", {type:QueryTypes.SELECT}),
  seq.query("SELECT COUNT(*) as n FROM jira_tickets WHERE tipo_atencion='presencial'", {type:QueryTypes.SELECT}),
  seq.query("SELECT DISTINCT detalle FROM ticket_history WHERE evento='cierre' LIMIT 5", {type:QueryTypes.SELECT}),
]).then(([pres,remota,jtp,det])=>{
  console.log('presencial en detalle:', JSON.stringify(pres));
  console.log('cierre remota:', JSON.stringify(remota));
  console.log('jira tipo presencial:', JSON.stringify(jtp));
  console.log('detalle patterns:', JSON.stringify(det));
  process.exit(0);
}).catch(e=>{console.error(e.message);process.exit(1)});
