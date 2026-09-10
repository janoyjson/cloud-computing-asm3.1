param(
  [Parameter(Mandatory = $true)]
  [string]$OwnerId,
  [string]$Profile = 'cloudsentinel-lab',
  [string]$Region = 'us-east-1'
)

if ($OwnerId -notmatch '^[a-zA-Z0-9_#-]{10,128}$') {
  throw 'OwnerId must be the application user ID from the JWT session, not an email address or password.'
}

$tableName = 'CloudSentinelMonitors'
$exclusiveStartKey = $null
$updated = 0

do {
  $scanArguments = @(
    'dynamodb', 'scan',
    '--table-name', $tableName,
    '--projection-expression', 'id',
    '--region', $Region,
    '--profile', $Profile,
    '--output', 'json'
  )
  if ($null -ne $exclusiveStartKey) {
    $scanArguments += @('--exclusive-start-key', ($exclusiveStartKey | ConvertTo-Json -Compress))
  }

  $page = (& aws @scanArguments | ConvertFrom-Json)
  foreach ($item in $page.Items) {
    $id = $item.id.S
    $key = @{ id = @{ S = $id } } | ConvertTo-Json -Compress
    $values = @{ ':ownerId' = @{ S = $OwnerId } } | ConvertTo-Json -Compress
    aws dynamodb update-item `
      --table-name $tableName `
      --key $key `
      --update-expression 'SET ownerId = :ownerId' `
      --expression-attribute-values $values `
      --condition-expression 'attribute_exists(id)' `
      --region $Region `
      --profile $Profile `
      --output none
    $updated++
  }

  $exclusiveStartKey = $page.LastEvaluatedKey
} while ($null -ne $exclusiveStartKey)

Write-Output "Assigned ownerId to $updated monitor records."
