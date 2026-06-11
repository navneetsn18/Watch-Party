const { DynamoDBClient, CreateTableCommand, DescribeTableCommand } = require('@aws-sdk/client-dynamodb');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env.local') });

const client = new DynamoDBClient({
  region: process.env.AWS_REGION || 'ap-south-1',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  }
});

async function createTableIfNotExists(params) {
  const tableName = params.TableName;
  try {
    await client.send(new DescribeTableCommand({ TableName: tableName }));
    console.log(`Table "${tableName}" already exists.`);
  } catch (err) {
    if (err.name === 'ResourceNotFoundException') {
      console.log(`Creating table "${tableName}"...`);
      await client.send(new CreateTableCommand(params));
      console.log(`Table "${tableName}" created successfully!`);
    } else {
      console.error(`Error checking table "${tableName}":`, err.message);
    }
  }
}

async function run() {
  console.log('Starting DynamoDB Table Provisioning...');

  // 1. Users Table (primary key: email, GSI: username)
  await createTableIfNotExists({
    TableName: 'watch_party_users',
    KeySchema: [
      { AttributeName: 'email', KeyType: 'HASH' }
    ],
    AttributeDefinitions: [
      { AttributeName: 'email', AttributeType: 'S' },
      { AttributeName: 'username', AttributeType: 'S' }
    ],
    GlobalSecondaryIndexes: [
      {
        IndexName: 'username-index',
        KeySchema: [
          { AttributeName: 'username', KeyType: 'HASH' }
        ],
        Projection: {
          ProjectionType: 'ALL'
        },
        ProvisionedThroughput: {
          ReadCapacityUnits: 5,
          WriteCapacityUnits: 5
        }
      }
    ],
    ProvisionedThroughput: {
      ReadCapacityUnits: 5,
      WriteCapacityUnits: 5
    }
  });

  // 2. Friendships Table (primary key: senderId, sort key: receiverId, GSI: receiverId-index)
  await createTableIfNotExists({
    TableName: 'watch_party_friendships',
    KeySchema: [
      { AttributeName: 'senderId', KeyType: 'HASH' },
      { AttributeName: 'receiverId', KeyType: 'RANGE' }
    ],
    AttributeDefinitions: [
      { AttributeName: 'senderId', AttributeType: 'S' },
      { AttributeName: 'receiverId', AttributeType: 'S' }
    ],
    GlobalSecondaryIndexes: [
      {
        IndexName: 'receiverId-index',
        KeySchema: [
          { AttributeName: 'receiverId', KeyType: 'HASH' },
          { AttributeName: 'senderId', KeyType: 'RANGE' }
        ],
        Projection: {
          ProjectionType: 'ALL'
        },
        ProvisionedThroughput: {
          ReadCapacityUnits: 5,
          WriteCapacityUnits: 5
        }
      }
    ],
    ProvisionedThroughput: {
      ReadCapacityUnits: 5,
      WriteCapacityUnits: 5
    }
  });

  // 3. Videos Table (primary key: filename)
  await createTableIfNotExists({
    TableName: 'watch_party_videos',
    KeySchema: [
      { AttributeName: 'filename', KeyType: 'HASH' }
    ],
    AttributeDefinitions: [
      { AttributeName: 'filename', AttributeType: 'S' }
    ],
    ProvisionedThroughput: {
      ReadCapacityUnits: 5,
      WriteCapacityUnits: 5
    }
  });

  console.log('Database initialization completed.');
}

run().catch(console.error);
