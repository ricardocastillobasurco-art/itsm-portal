# Respaldos de la base de datos

Copia **diaria y cifrada** de la base de producción, hecha por GitHub Actions
(`.github/workflows/backup.yml`) a las 03:00 (hora de Lima). Cada copia se guarda
30 días como artefacto privado del repositorio, fuera de Railway.

- Cifrado AES-256 con una contraseña que solo tú conoces: aunque alguien descargue el
  archivo, no puede leerlo sin ella.
- La copia se valida antes de guardarse (que esté completa y no vacía).
- Probado: copia → cifrado → restauración en MySQL 8 con las mismas tablas y acentos/ñ intactos.

---

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
