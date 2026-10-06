# Control remoto de equipos (RMM) con MeshCentral

Guía para montar el servidor de control remoto **una sola vez**, de forma segura,
y conectarlo al portal. Tiempo estimado: 1 hora.

```
Internet
 ├─ Railway ................ portal + MySQL (no cambia)
 │                             │  cuenta de servicio "portal" (cifrada)
 │                             ▼
 └─ Servidor propio (VPS) .. MeshCentral  →  https://rmm.tumarca.com
                               ▲  agentes de las PCs de tus clientes (salen por 443)
```

- Las PCs de tus clientes solo necesitan **salir a internet por el puerto 443**: el cliente no abre nada en su red.
- El usuario **debe aceptar** antes de que alguien vea su pantalla (o se acepta solo si nadie está usando la PC o está bloqueada), y ve una **barra** mientras está conectado.
- Escritorio, consola y archivos se **graban** 90 días.
- Respaldo automático **diario y cifrado** de MeshCentral.

Archivos en el repositorio: `deploy/meshcentral/` (`docker-compose.yml`, `Dockerfile`, `config.json`, `instalar-servidor.sh`).

---

## 1. Contratar el servidor (15 min)

**Requisitos:** Ubuntu **24.04 LTS**, **2 GB de RAM**, 1–2 vCPU, 40 GB de disco. Con eso caben cientos de equipos.

**Región:** lo más cerca posible de tus clientes (el escritorio remoto se siente más rápido).
Opciones con región en Sudamérica, por ejemplo: **Vultr** (São Paulo / Santiago / Ciudad de México) o **AWS Lightsail** (São Paulo).
Si no, EE. UU. este (Miami / Nueva York). Revisa el precio vigente en la web del proveedor (suele estar entre US$ 6 y 12 al mes).

Al crearlo:
1. **Activa las copias automáticas del proveedor** ("Backups" / "Snapshots"). Es la red de seguridad más simple.
2. **Acceso con llave SSH** (más seguro que contraseña). En Windows, abre PowerShell:
   ```powershell
   ssh-keygen -t ed25519        # Enter a todo; crea C:\Users\TU_USUARIO\.ssh\id_ed25519.pub
   type $env:USERPROFILE\.ssh\id_ed25519.pub
   ```
   Copia ese texto y pégalo en el proveedor donde dice "SSH key".
3. Anota la **IP pública** del servidor.

## 2. Dominio (10 min)

En el panel donde administras tu dominio (o compra uno), crea un registro **A**:

| Tipo | Nombre | Valor |
|---|---|---|
| A | `rmm` | IP del servidor |

Queda `rmm.tumarca.com`. Espera 5–15 minutos a que se propague.

## 3. Subir los archivos (5 min)

Con **WinSCP** (gratuito): protocolo SFTP, host = IP del servidor, usuario `root` (o `ubuntu` en Lightsail), tu llave SSH.
Sube la carpeta `deploy/meshcentral` del repositorio a `/opt/meshcentral` en el servidor.

## 4. Instalar (15 min, automático)

En PowerShell:
```powershell
ssh root@IP_DEL_SERVIDOR
```
Y en el servidor:
```bash
cd /opt/meshcentral
sudo bash instalar-servidor.sh
```
Te pedirá el dominio, tu correo y tu usuario. El script:
actualiza el sistema · activa parches de seguridad automáticos · firewall (solo 22, 80 y 443) ·
protección contra fuerza bruta · instala Docker · crea **tu cuenta** y la **cuenta del portal** antes de abrir
el servidor · obtiene el certificado · inicia MeshCentral.

Al final muestra **cuatro datos que no se vuelven a mostrar**: tu contraseña, la de la cuenta `portal`, la
**llave de inicio de sesión** y la clave de los respaldos. **Guárdalos en tu gestor de contraseñas.**

## 5. Primer ingreso (10 min)

1. Abre `https://rmm.tumarca.com` e ingresa con tu usuario.
2. **Activa la verificación en dos pasos**: Mi cuenta → Seguridad → *Autenticación de dos factores* (app Google/Microsoft Authenticator).
3. Los grupos de dispositivos (uno por cliente o por sede) **se crean desde el portal** (paso 6).
   Si creas uno en la web de MeshCentral, agrega la cuenta `portal` a ese grupo: en MeshCentral ser
   administrador **no** da acceso a los grupos de otros.

## 6. Conectar el portal (5 min)

1. En **Railway → servicio de la app → Variables**, confirma que exista `CONFIG_ENCRYPTION_KEY`
   (es la que cifra la contraseña de MeshCentral en la base). Si no existe, créala con un texto largo al azar
   y **no la cambies nunca**.
2. En el portal, como **superadmin**, abre **RMM** (`/rmm`) → botón ⚙ **Configuración MeshCentral**:
   - URL y URL pública: `https://rmm.tumarca.com`
   - Usuario: `portal` · Contraseña y **llave de inicio de sesión**: las que mostró el script.
   - Guardar. Debe decir **Conectado**.
   - La llave permite que, al pulsar *Conectar*, se abra la sesión **sin pedir usuario**, con una cuenta
     de MeshCentral **propia de cada empresa** (el portal la crea sola) que solo ve los equipos de esa empresa.
     El enlace sirve **una sola vez** y vence en 5 minutos.
3. En la misma pantalla, botón **Grupos por tenant**: elige la empresa y pulsa **Crear grupo** (p. ej.
   `Acme - Oficina Lima`). Cada empresa solo ve y controla los equipos de sus grupos; sin grupos no ve ninguno.

### Cliente con servidor propio (opcional)
Si un cliente exige su propio MeshCentral (p. ej. por política de seguridad), instálalo igual que este
(en un servidor para ese cliente) y en el portal: **Superadmin → la empresa → Conexiones → RMM · servidor propio**:
URL, usuario `portal`, contraseña y llave de ese servidor, y **actívalo**. Esa empresa verá todos los equipos de
su servidor; el resto sigue en el compartido. Los grupos de ese servidor deben crearse con su cuenta `portal`.

## 7. Instalar el agente en las PCs del cliente

En MeshCentral → grupo del cliente → **Agregar agente** → *Windows (.exe)*.
Ese instalador ya va ligado al grupo: lo ejecutas en cada PC (o lo distribuye el TI del cliente) y el equipo aparece solo.

> Próximo paso en el portal: botón **"Instalar agente"** en la empresa, para no entrar a MeshCentral.

**Si hoy tienes agentes apuntando al MeshCentral antiguo** (el de la red interna), no se mudan solos:
instala el agente nuevo en esas PCs y luego desinstala el antiguo.

## 8. Respaldos

| Qué | Cómo | Frecuencia |
|---|---|---|
| Servidor completo | Copias automáticas del proveedor (paso 1) | Diaria/semanal |
| MeshCentral (`meshcentral-data`: **certificados**, cuentas, grupos) | Automático en `/opt/meshcentral/meshcentral-backups` (zip cifrado, 14 días) | Diaria |
| Copia fuera del servidor | Descarga con WinSCP el `.zip` más reciente de `meshcentral-backups` a tu Drive/OneDrive | Mensual |

> ⚠️ Si se pierden los **certificados** de `meshcentral-data`, hay que **reinstalar el agente en todas las PCs**.
> Por eso hay tres niveles de copia.

## 9. Mantenimiento

- **Sistema operativo:** se actualiza solo (parches de seguridad).
- **MeshCentral:** no se actualiza solo (a propósito). Cada 2–3 meses:
  1. Revisa la última versión en <https://github.com/Ylianst/MeshCentral/releases>.
  2. Cambia la versión en `Dockerfile` (y en `docker-compose.yml`, línea `image:`).
  3. `cd /opt/meshcentral && sudo docker compose build && sudo docker compose up -d`
  4. Antes, confirma que exista un respaldo reciente.
- **Monitoreo gratuito:** crea un chequeo en [UptimeRobot](https://uptimerobot.com) a `https://rmm.tumarca.com`
  para recibir un correo si se cae.

## 10. Lista de seguridad

- [ ] Verificación en dos pasos en tu cuenta de MeshCentral.
- [ ] Contraseñas guardadas en un gestor (no en notas ni chats).
- [ ] `CONFIG_ENCRYPTION_KEY` definida en Railway.
- [ ] Copias automáticas del proveedor activadas.
- [ ] Cada empresa con **sus** grupos asignados en el portal.
- [ ] Tus técnicos entran **por el portal**; solo tú entras directo a MeshCentral.
- [ ] Informar al cliente (contrato) que las sesiones remotas se graban y que el usuario debe aceptar.

## 11. Problemas comunes

| Síntoma | Causa / solución |
|---|---|
| El script dice que el dominio no apunta al servidor | Revisa el registro **A** del paso 2 y espera unos minutos. |
| No carga `https://rmm...` | `cd /opt/meshcentral && sudo docker compose logs --tail 50`. Revisa que los puertos 80 y 443 estén abiertos también en el **firewall del proveedor** (algunos tienen uno propio). |
| El portal dice "Desconectado" | URL con `https://`, usuario `portal`, contraseña correcta. Guardar de nuevo. |
| El usuario no ve el aviso para aceptar | El aviso aparece en la sesión de Windows activa; si la PC está bloqueada o sin usuario, se acepta solo (configurable en `config.json` → `consentMessages`). |
| Una PC no aparece | Revisa que tenga internet y que el agente sea el del grupo correcto. |

---

**Verificado antes de publicar:** `config.json` validado contra el esquema oficial de MeshCentral 1.2.6;
servidor iniciado con esa configuración en Docker; creación de cuentas por consola; conexión del portal
(cuenta de servicio), contraseña cifrada en la base y reconexión automática tras reiniciar el portal.
No probado aquí (requiere servidor público): certificado de Let's Encrypt e instalación de agentes por internet.
