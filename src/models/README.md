# src/models/

Modelos Sequelize organizados por dominio. **Siempre importar desde el index agregado:**

```js
const { Ticket, User, ServiceRequest } = require('../models');
```

| Carpeta | Modelos |
|---|---|
| `platform/` | Tenant, User, Role, Permission, AuditLog, BusinessRule |
| `service-management/` | Ticket, TicketComment, TicketAttachment, TicketSurvey, Change, Problem, KnownError, SLAPolicy, Category |
| `service-operations/` | ServiceRequest, ApprovalFlow, Service, ServiceCategory |
| `experience/` | KbArticle, KbCategory, Notification |
| `analytics/` | CsiInitiative, ReportJob |
| `asset-management/` | CiType, ConfigItem, CiRelationship |
| `integrations/` | UserToolData, UserToolHistory |

Las asociaciones se definen **únicamente** en `index.js`.
