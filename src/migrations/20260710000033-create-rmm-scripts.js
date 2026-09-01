'use strict';

const COLLECTIONS = [
    { id: 1, name: 'Limpieza',    description: 'Scripts para liberar espacio y borrar archivos innecesarios', icon: 'bi-trash3',       sort_order: 10 },
    { id: 2, name: 'Diagnóstico', description: 'Información del sistema, red y rendimiento',                  icon: 'bi-tools',         sort_order: 20 },
    { id: 3, name: 'Seguridad',   description: 'Auditoría de usuarios, servicios y configuración',            icon: 'bi-shield-check',  sort_order: 30 },
    { id: 4, name: 'Red',         description: 'Diagnóstico y configuración de red',                         icon: 'bi-wifi',          sort_order: 40 },
];

// Los scripts están en variables separadas para no embeber PS dentro de template literals JS
const S = {
    limpiarTemp: [
        'Write-Host "=== Limpiando archivos temporales ===" -ForegroundColor Cyan',
        '$dirs=@($env:TEMP,"C:\\Windows\\Temp","C:\\Windows\\Prefetch")',
        '$total=0',
        'foreach($dir in $dirs){',
        '  if(Test-Path $dir){',
        '    $files=Get-ChildItem $dir -Recurse -Force -ErrorAction SilentlyContinue',
        '    $size=($files|Measure-Object -Property Length -Sum -ErrorAction SilentlyContinue).Sum',
        '    $total+=$size',
        '    Remove-Item "$dir\\*" -Recurse -Force -ErrorAction SilentlyContinue',
        '    Write-Host "  Limpiado: $dir"',
        '  }',
        '}',
        'Write-Host "Total liberado: $([Math]::Round($total/1MB,1)) MB" -ForegroundColor Green',
    ].join('\r\n'),

    vaciarPapelera: [
        'Write-Host "Vaciando Papelera de reciclaje..." -ForegroundColor Cyan',
        'Clear-RecycleBin -Force -ErrorAction SilentlyContinue',
        'Write-Host "Papelera vaciada correctamente." -ForegroundColor Green',
    ].join('\r\n'),

    limpiarDns: [
        'Write-Host "Limpiando cache DNS..." -ForegroundColor Cyan',
        'ipconfig /flushdns',
        'Write-Host "Cache DNS limpiado." -ForegroundColor Green',
    ].join('\r\n'),

    infoSistema: [
        'Write-Host "=== INFORMACION DEL SISTEMA ===" -ForegroundColor Cyan',
        '$r = Get-ItemProperty \'HKLM:\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\' -EA Stop',
        'Write-Host "  Equipo    : $env:COMPUTERNAME"',
        'Write-Host "  OS        : $($r.ProductName) $($r.DisplayVersion)"',
        'Write-Host "  Build     : $($r.CurrentBuildNumber)"',
        '$up = [System.TimeSpan]::FromMilliseconds([System.Environment]::TickCount64)',
        'Write-Host "  Uptime    : $([int]$up.TotalDays)d $($up.Hours)h $($up.Minutes)m"',
        'try{$ramGB=[Math]::Round((Get-CimInstance Win32_ComputerSystem -OperationTimeoutSec 4).TotalPhysicalMemory/1GB,1);Write-Host "  RAM total : $ramGB GB"}catch{Write-Host "  RAM total : (no disponible)"}',
        'Write-Host ""',
        'Write-Host "=== RED ===" -ForegroundColor Cyan',
        'Get-NetIPAddress -AddressFamily IPv4 -EA SilentlyContinue|Where-Object{$_.IPAddress -notmatch "^(127\\.|169\\.254\\.)"}|ForEach-Object{Write-Host "  $($_.InterfaceAlias): $($_.IPAddress)/$($_.PrefixLength)"}',
        'Write-Host ""',
        'Write-Host "=== DISCOS ===" -ForegroundColor Cyan',
        'Get-PSDrive -PSProvider FileSystem|Where-Object{$_.Used -ne $null}|ForEach-Object{$t=[Math]::Round(($_.Used+$_.Free)/1GB,1);$u=[Math]::Round($_.Used/1GB,1);$p=if($t -gt 0){[Math]::Round($_.Used/($_.Used+$_.Free)*100)}else{0};Write-Host "  $($_.Name): $u/$t GB ($p% usado)"}',
    ].join('\r\n'),

    topProcesos: [
        'Write-Host "=== TOP 15 PROCESOS POR CPU ===" -ForegroundColor Cyan',
        'Get-Process|Sort-Object CPU -Descending|Select-Object -First 15|',
        '  Format-Table Name,Id,',
        '    @{N="CPU(s)";E={[Math]::Round($_.CPU,1)}},',
        '    @{N="RAM(MB)";E={[Math]::Round($_.WorkingSet/1MB,1)}},',
        '    StartTime -AutoSize|Out-String|Write-Host',
    ].join('\r\n'),

    serviciosActivos: [
        'Write-Host "=== SERVICIOS EN EJECUCION ===" -ForegroundColor Cyan',
        'Get-Service|Where-Object{$_.Status -eq "Running"}|Sort-Object Name|',
        '  Format-Table Name,DisplayName,StartType -AutoSize|Out-String|Write-Host',
    ].join('\r\n'),

    usuariosLocales: [
        'Write-Host "=== USUARIOS LOCALES ===" -ForegroundColor Cyan',
        'Get-LocalUser|Format-Table Name,Enabled,LastLogon,PasswordLastSet -AutoSize|Out-String|Write-Host',
        'Write-Host "=== GRUPO ADMINISTRADORES ===" -ForegroundColor Yellow',
        'Get-LocalGroupMember -Group "Administrators" -ErrorAction SilentlyContinue|',
        '  Format-Table Name,ObjectClass,PrincipalSource -AutoSize|Out-String|Write-Host',
    ].join('\r\n'),

    conexionesRed: [
        'Write-Host "=== CONEXIONES DE RED ACTIVAS ===" -ForegroundColor Cyan',
        'Get-NetTCPConnection -State Established|',
        '  Select-Object LocalAddress,LocalPort,RemoteAddress,RemotePort,',
        '    @{N="Proceso";E={(Get-Process -Id $_.OwningProcess -ErrorAction SilentlyContinue).Name}}|',
        '  Sort-Object RemoteAddress|Format-Table -AutoSize|Out-String|Write-Host',
    ].join('\r\n'),

    configRed: [
        'Write-Host "=== CONFIGURACION DE RED ===" -ForegroundColor Cyan',
        'ipconfig /all',
    ].join('\r\n'),

    testConectividad: [
        'Write-Host "=== TEST DE CONECTIVIDAD ===" -ForegroundColor Cyan',
        '$targets=@("8.8.8.8","1.1.1.1","google.com","microsoft.com")',
        'foreach($t in $targets){',
        '  $r=Test-Connection $t -Count 2 -Quiet -ErrorAction SilentlyContinue',
        '  $ok=if($r){"OK"}else{"FALLO"}',
        '  Write-Host "  $t : $ok"',
        '}',
    ].join('\r\n'),
};

const SCRIPTS = [
    { collection_id: 1, name: 'Borrar archivos temporales',  description: 'Elimina archivos en %TEMP%, Windows\\Temp y Prefetch', code: S.limpiarTemp },
    { collection_id: 1, name: 'Vaciar Papelera de reciclaje', description: 'Vacía la papelera de todos los usuarios',             code: S.vaciarPapelera },
    { collection_id: 1, name: 'Limpiar cache DNS',            description: 'Ejecuta ipconfig /flushdns',                          code: S.limpiarDns },
    { collection_id: 2, name: 'Información del sistema',      description: 'OS, hardware, uptime y espacio en disco',             code: S.infoSistema },
    { collection_id: 2, name: 'Procesos por CPU (top 15)',    description: 'Lista los 15 procesos que más CPU consumen',          code: S.topProcesos },
    { collection_id: 2, name: 'Servicios activos',            description: 'Muestra todos los servicios en estado Running',       code: S.serviciosActivos },
    { collection_id: 3, name: 'Usuarios locales y grupos',    description: 'Lista usuarios y miembros del grupo Administradores', code: S.usuariosLocales },
    { collection_id: 3, name: 'Conexiones de red activas',    description: 'TCP connections establecidas con proceso asociado',   code: S.conexionesRed },
    { collection_id: 4, name: 'Configuración de red',         description: 'Equivalente a ipconfig /all',                        code: S.configRed },
    { collection_id: 4, name: 'Test de conectividad',         description: 'Prueba conexión a 8.8.8.8, 1.1.1.1 y dominios',     code: S.testConectividad },
];

module.exports = {
    async up(queryInterface) {
        const { sequelize } = queryInterface;
        const q = sql => sequelize.query(sql);

        await q(`
            CREATE TABLE IF NOT EXISTS rmm_script_collections (
                id          INT AUTO_INCREMENT PRIMARY KEY,
                name        VARCHAR(100) NOT NULL,
                description VARCHAR(255),
                icon        VARCHAR(50)  DEFAULT 'bi-collection',
                sort_order  INT          DEFAULT 0,
                created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at  DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
        `);

        await q(`
            CREATE TABLE IF NOT EXISTS rmm_scripts (
                id            INT AUTO_INCREMENT PRIMARY KEY,
                collection_id INT NOT NULL,
                name          VARCHAR(150) NOT NULL,
                description   VARCHAR(500),
                code          LONGTEXT NOT NULL,
                created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at    DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                CONSTRAINT fk_rmm_scripts_col
                    FOREIGN KEY (collection_id)
                    REFERENCES rmm_script_collections(id)
                    ON DELETE CASCADE
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
        `);

        // Insertar colecciones — ignorar si ya existen (re-run safe)
        const existing = await sequelize.query(
            'SELECT COUNT(*) AS cnt FROM rmm_script_collections',
            { type: sequelize.QueryTypes.SELECT }
        );
        if (existing[0].cnt > 0) return;

        await queryInterface.bulkInsert('rmm_script_collections', COLLECTIONS);
        await queryInterface.bulkInsert('rmm_scripts', SCRIPTS.map(s => ({
            ...s,
            created_at: new Date(),
            updated_at: new Date(),
        })));
    },

    async down(queryInterface) {
        const { sequelize } = queryInterface;
        await sequelize.query('DROP TABLE IF EXISTS rmm_scripts');
        await sequelize.query('DROP TABLE IF EXISTS rmm_script_collections');
    },
};
