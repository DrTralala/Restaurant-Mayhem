import { describe, expect, it } from 'vitest';
import { getStaffTaskRoles, isStaffTaskRoleAllowed } from './taskRoles';

describe('staff task roles', () => {
  it('assigns dirty logistics to waiters and cleaning to janitors', () => {
    const roles = getStaffTaskRoles();

    expect([...roles.waiter]).toEqual(expect.arrayContaining([
      'collect_dirty_item', 'deliver_dirty_item', 'transfer_dirty_item',
    ]));
    expect([...roles.janitor]).toEqual(expect.arrayContaining([
      'clean_table', 'clean_floor', 'wash_item',
    ]));
    expect(isStaffTaskRoleAllowed({ type: 'collect_dirty_item' }, 'waiter')).toBe(true);
    expect(isStaffTaskRoleAllowed({ type: 'deliver_dirty_item' }, 'waiter')).toBe(true);
    expect(isStaffTaskRoleAllowed({ type: 'transfer_dirty_item' }, 'waiter')).toBe(true);
    expect(isStaffTaskRoleAllowed({ type: 'collect_dirty_item' }, 'janitor')).toBe(false);
    expect(isStaffTaskRoleAllowed({ type: 'deliver_dirty_item' }, 'janitor')).toBe(false);
    expect(isStaffTaskRoleAllowed({ type: 'transfer_dirty_item' }, 'janitor')).toBe(false);
    expect(isStaffTaskRoleAllowed({ type: 'wash_item' }, 'waiter')).toBe(false);
    expect(isStaffTaskRoleAllowed({ type: 'clean_table' }, 'waiter')).toBe(false);
    expect(isStaffTaskRoleAllowed({ type: 'clean_floor' }, 'waiter')).toBe(false);
  });

  it('does not expose retired disposal or cancellation-handoff tasks', () => {
    const roles = getStaffTaskRoles();
    const taskTypes = [...roles.cook, ...roles.waiter, ...roles.janitor];
    expect(taskTypes).not.toContain('clean_service_item');
    expect(taskTypes).not.toContain('handoff_cancelled_waste');
  });
});
