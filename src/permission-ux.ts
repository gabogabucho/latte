import type { WorkPermissionMode } from '../shared/contracts';

/** The browser preview has no setter; only the mutation itself locks this control. */
export const canChangePermission = (mode: WorkPermissionMode, next: WorkPermissionMode, busy: boolean, isDesktop: boolean) => isDesktop && !busy && next !== mode;
