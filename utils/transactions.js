// Retry only conflicts for which Prisma guarantees transaction rollback.
// The callback must keep every write inside tx and perform no external effects.
export async function runSerializable(client, work, maxAttempts = 3) {
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await client.$transaction(work, { isolationLevel: "Serializable" });
    } catch (error) {
      // Raw PostgreSQL statements (including SELECT ... FOR UPDATE) expose
      // serialization_failure as P2010 + SQLSTATE, rather than P2034.
      const serializationConflict = error?.code === "P2034" ||
        (error?.code === "P2010" && (
          error?.meta?.code === "40001" ||
          error?.meta?.driverAdapterError?.cause?.originalCode === "40001"
        ));
      if (!serializationConflict || attempt === maxAttempts) throw error;
      await new Promise((resolve) => setTimeout(resolve, 20 * attempt));
    }
  }
}
