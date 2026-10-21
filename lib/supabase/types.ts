/**
 * Auth session typing only. Supabase is not the application database.
 * Tables, limits, and roles are defined in prisma/schema.prisma and
 * read through lib/usage/store.ts.
 */
export type Database = {
  public: {
    Tables: Record<string, never>
    Views: Record<string, never>
    Functions: Record<string, never>
    Enums: Record<string, never>
    CompositeTypes: Record<string, never>
  }
}
