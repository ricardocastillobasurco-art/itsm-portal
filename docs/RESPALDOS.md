# Respaldos de la base de datos

Hay dos formas. **Basta con una**; lo importante es que exista alguna copia.

| | Opción A — Manual (HeidiSQL) | Opción B — Automática (GitHub) |
|---|---|---|
| Cómo | Te conectas desde tu PC y exportas un `.sql` | GitHub hace la copia sola cada noche |
| Frecuencia | Cuando tú lo hagas (recomendado: 1 vez por semana y antes de cambios grandes) | Diaria, 03:00 hora de Lima |
| Dónde queda | Donde la guardes (PC, Google Drive, OneDrive) | En GitHub, cifrada, 30 días |
| Ventaja | Simple, ya lo conoces de XAMPP | No depende de que te acuerdes |

---

## Opción A — Copia manual con HeidiSQL

[HeidiSQL](https://www.heidisql.com/download.php) es gratuito, para Windows y en español.
(El phpMyAdmin de XAMPP está pensado para tu base local; para conectarse a Railway es más fácil HeidiSQL.)

### A.1 Datos de conexión de Railway (una sola vez)
1. Railway → tu proyecto → servicio **MySQL** → pestaña **Variables**.
2. Busca `MYSQL_PUBLIC_URL`. Tiene esta forma:
   `mysql://USUARIO:CONTRASEÑA@HOST:PUERTO/BASE`
   (por ejemplo `mysql://root:abc123@monorail.proxy.rlwy.net:41234/railway`)
3. Si no aparece, en **Settings → Networking** activa **TCP Proxy** (conexión pública) y vuelve al paso 2.

> 🔒 Esa URL contiene la contraseña de tu base: no la compartas ni la subas al repositorio.

### A.2 Conectarte con HeidiSQL (una sola vez)
1. Abre HeidiSQL → **Nueva** (abajo a la izquierda).
2. Tipo de red: **MariaDB or MySQL (TCP/IP)**.
3. Completa con los datos de la URL:
   - **Nombre del host / IP:** el HOST (p. ej. `monorail.proxy.rlwy.net`)
   - **Usuario:** USUARIO · **Contraseña:** CONTRASEÑA · **Puerto:** PUERTO
4. **Guardar** → **Abrir**. A la izquierda verás la base (p. ej. `railway`).

### A.3 Exportar la copia
1. Clic derecho sobre la base → **Exportar base de datos como SQL**.
2. Marca:
   - **Base(s) de datos:** *(nada)* — así luego puedes importarla en la base que quieras.
   - **Tabla(s):** ✔ **Crear** (y **Eliminar** si quieres que reemplace tablas al importar).
   - **Datos:** **Insertar**.
   - Selecciona **todas** las tablas de la lista.
3. **Salida:** *Un único archivo .sql* → elige la carpeta y un nombre con fecha, p. ej. `itsm-2026-10-05.sql`.
4. **Exportar**. Al terminar, guarda una copia fuera de tu PC (Google Drive / OneDrive).

> Recomendado: comprímelo en `.zip` con contraseña si lo subes a la nube; contiene datos de tus clientes.

### A.4 Cargar la copia en tu XAMPP (para revisar o trabajar en local)
Tu XAMPP usa **MariaDB** y Railway usa **MySQL 8**. Hay una diferencia que debes corregir antes de importar:

1. Abre el `.sql` con **VS Code** (o Notepad++).
2. **Buscar y reemplazar todo:**
   - `utf8mb4_0900_ai_ci` → `utf8mb4_unicode_ci`
   - (si aparece) `utf8mb4_0900_as_cs` → `utf8mb4_bin`
3. Guarda.
4. Crea una base vacía en XAMPP (p. ej. `itsm_copia`) e impórtala:
   - **Archivo pequeño (< 40 MB):** phpMyAdmin → base `itsm_copia` → **Importar**.
   - **Archivo grande:** HeidiSQL conectado a tu XAMPP (`127.0.0.1`, usuario `root`, puerto `3306`)
     → selecciona `itsm_copia` → **Archivo → Ejecutar archivo SQL…**

### A.5 Restaurar en Railway (solo en una emergencia)
1. **Nunca sobre la base actual directamente.** En HeidiSQL conectado a Railway crea una base nueva
   (clic derecho → *Crear nuevo → Base de datos*, p. ej. `railway_restaurada`, cotejamiento `utf8mb4_unicode_ci`).
2. Selecciónala → **Archivo → Ejecutar archivo SQL…** → el `.sql` de la copia (el original, sin el reemplazo del paso A.4).
3. Revisa que estén tus datos. Luego, en Railway → servicio de la **app** → Variables, cambia
   `EQUIPMENT_DATABASE` al nombre de la base restaurada y vuelve a desplegar.

---

## Opción B — Copia automática y cifrada (GitHub)

Copia **diaria y cifrada** de la base de producción, hecha por GitHub Actions
(`.github/workflows/backup.yml`) a las 03:00 (hora de Lima). Cada copia se guarda
30 días como artefacto privado del repositorio, fuera de Railway.

- Cifrado AES-256 con una contraseña que solo tú conoces: aunque alguien descargue el
  archivo, no puede leerlo sin ella.
- La copia se valida antes de guardarse (que esté completa y no vacía).
- Probado: copia → cifrado → restauración en MySQL 8 con las mismas tablas y acentos/ñ intactos.
- No necesitas Docker ni nada instalado: corre en los servidores de GitHub.

## 1. Configuración (una sola vez, ~15 min)

### 1.1 Datos de conexión pública de la base (Railway)
1. Railway → servicio **MySQL** → pestaña **Variables** (o **Connect** → *Public Network*).
2. Anota: host público (algo como `xxxx.proxy.rlwy.net`), puerto público, usuario, contraseña y nombre de la base.

> Recomendado (opcional): un usuario solo de lectura para respaldos. En la consola de MySQL:
> ```sql
> CREATE USER 'backup'@'%' IDENTIFIED BY 'una-clave-larga';
> GRANT SELECT, SHOW VIEW, TRIGGER, EVENT ON nombre_de_la_base.* TO 'backup'@'%';
> ```

### 1.2 Secretos en GitHub
GitHub → repositorio → **Settings → Secrets and variables → Actions → New repository secret**:

| Secreto | Valor |
|---|---|
| `BACKUP_DB_HOST` | host público |
| `BACKUP_DB_PORT` | puerto público |
| `BACKUP_DB_USER` | usuario (`backup` o el de Railway) |
| `BACKUP_DB_PASSWORD` | contraseña de ese usuario |
| `BACKUP_DB_NAME` | nombre de la base |
| `BACKUP_PASSPHRASE` | una frase larga para cifrar (p. ej. 5–6 palabras) |

> ⚠️ **Guarda `BACKUP_PASSPHRASE` también fuera de GitHub** (gestor de contraseñas). Sin ella las copias no se pueden abrir.

### 1.3 Primera prueba
GitHub → **Actions → "Backup diario de la base de datos" → Run workflow**. Al terminar (verde),
abre la ejecución: abajo aparece el artefacto `backup-AAAAMMDD-HHMM`.

---

## 2. Restaurar una copia

1. GitHub → Actions → la ejecución del día que necesitas → descarga el artefacto (viene en .zip) y descomprímelo:
   queda `itsm-AAAAMMDD-HHMM.sql.gz.gpg`.
2. En una máquina con `mysql` y `gpg` (Linux, Mac, WSL o el contenedor de MySQL):
   ```sh
   BACKUP_PASSPHRASE='tu frase' \
   DB_HOST=host DB_PORT=puerto DB_USER=usuario DB_PASSWORD=clave \
   DB_NAME=itsm_restaurada \
   sh scripts/backup/restore.sh itsm-AAAAMMDD-HHMM.sql.gz.gpg
   ```
3. **Restaura siempre primero en una base nueva** (`itsm_restaurada`), revisa que esté bien y recién
   entonces apunta la aplicación a ella (variable `EQUIPMENT_DATABASE`) o copia lo necesario.

Si la contraseña es incorrecta o el archivo está dañado, el script se detiene **sin tocar** ninguna base.

---

## 3. Simulacro (recomendado cada 3 meses)
Restaurar la copia más reciente en una base de prueba y comprobar que se puede iniciar sesión y ver
tickets. Un respaldo que nunca se probó no es un respaldo.

## 4. Pendiente / mejoras
- Adjuntos (`/app/uploads`): no están en esta copia. Hoy dependen del Volume de Railway; al migrar a
  Azure se guardarán en Blob Storage con su propia redundancia.
- Al pasar a Azure Database for MySQL: además de esto, activar los backups automáticos del servicio
  (restauración a un punto en el tiempo).
