# MeshCentral con los complementos que usa nuestra configuración ya instalados.
# Sin esto, MeshCentral los descarga de npm en CADA arranque: si npm no responde
# en ese momento, el servidor no inicia. Así se descargan una sola vez al construir.
FROM ghcr.io/ylianst/meshcentral:1.2.6

#  image-size              → índice de las grabaciones de sesiones
#  archiver-zip-encrypted  → respaldos automáticos cifrados (zipPassword)
#  wildleek                → bloqueo de contraseñas comunes
#  acme-client             → certificado automático de Let's Encrypt
# Las versiones deben coincidir con las que pide MeshCentral 1.2.6 (meshcentral.js).
RUN cd /opt/meshcentral/meshcentral \
 && npm install --no-audit --no-fund --omit=optional \
      image-size@2.0.2 archiver-zip-encrypted@2.0.0 wildleek@2.0.0 acme-client@4.2.5 \
 && npm cache clean --force
