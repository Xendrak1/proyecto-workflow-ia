from uuid import uuid4

from app.models.policy import Policy, PolicyNode
from app.models.tramite import Task, Tramite
from app.services.policy_service import find_node, get_start_targets, resolve_next_nodes


def build_first_task(tramite: Tramite, policy: Policy) -> Task | None:
    start_transitions = get_start_targets(policy)
    if start_transitions:
        selected = find_node(policy, start_transitions[0].target_code)
    else:
        selected = next((n for n in policy.nodes if n.node_type == "actividad"), None)

    if not selected:
        return None

    return build_task_from_node(tramite, policy, selected)


def build_task_from_node(tramite: Tramite, policy: Policy, node: PolicyNode) -> Task:
    return Task(
        id=str(uuid4()),
        tramite_id=tramite.code,
        policy_id=policy.id or "",
        node_code=node.code,
        title=node.name,
        assigned_role=node.responsible_role,
        assigned_department=node.responsible_department,
    )


def build_next_tasks(tramite: Tramite, policy: Policy, current_node_code: str, form_data: dict | None = None) -> list[Task]:
    next_nodes = resolve_next_nodes(policy, current_node_code, form_data)
    return [build_task_from_node(tramite, policy, node) for node in next_nodes if node.node_type == "actividad"]
