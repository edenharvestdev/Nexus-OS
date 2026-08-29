import type { UserRole } from "@/constants/auth";
import { USER_ROLES } from "@/constants/auth";

export type AuthorizedActor = {
  role: UserRole;
  userId: string;
};

/** Resolve authority only from the database profile role. */
export function resolveDatabaseRole(role: unknown): UserRole | null {
  if (role === USER_ROLES.ADMIN || role === USER_ROLES.CLIENT) {
    return role;
  }
  return null;
}

/** Pure policy used by service-role paths before selecting a tenant resource. */
export function authorizeTenantAccess(
  actor: AuthorizedActor | null,
  resourceClientId: string,
  actorClientId: string | null,
): boolean {
  if (!actor) return false;
  if (actor.role === USER_ROLES.ADMIN) return true;
  return actor.role === USER_ROLES.CLIENT && actorClientId !== null && resourceClientId === actorClientId;
}
