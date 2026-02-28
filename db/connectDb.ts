import { ensureDatabaseConnection } from '@/lib/db/database';

const connectDb = async () => {
  try {
    await ensureDatabaseConnection();
  } catch (error) {
    // Instead of process.exit(1), throw an error that can be caught by the caller
    throw new Error(`Failed to connect to MongoDB: ${error instanceof Error ? error.message : String(error)}`);
  }
};

export default connectDb;
