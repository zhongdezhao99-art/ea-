$ErrorActionPreference = "Stop"

$mysqlBin = "C:\Program Files\MySQL\MySQL Server 8.4\bin\mysqld.exe"
$config = "C:\Users\13950\Desktop\ea web demo\mysql-dev\my.ini"

$existing = Get-NetTCPConnection -LocalPort 3306 -ErrorAction SilentlyContinue
if ($existing) {
  Write-Host "MySQL is already listening on 127.0.0.1:3306"
  exit 0
}

Start-Process -FilePath $mysqlBin `
  -ArgumentList "--defaults-file=`"$config`"" `
  -WorkingDirectory "C:\Users\13950\Desktop\ea web demo\mysql-dev" `
  -WindowStyle Hidden

Start-Sleep -Seconds 3

$started = Get-NetTCPConnection -LocalPort 3306 -ErrorAction SilentlyContinue
if ($started) {
  Write-Host "MySQL started on 127.0.0.1:3306"
} else {
  throw "MySQL did not start. Check mysql-dev/data/*.err for details."
}
