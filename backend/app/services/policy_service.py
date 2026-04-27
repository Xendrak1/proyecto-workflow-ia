from app.models.policy import Policy, PolicyNode, PolicyTransition


def validate_policy(policy: Policy) -> list[str]:
    observations: list[str] = []

    if not policy.nodes:
        observations.append("La politica no tiene nodos configurados.")

    node_codes = {node.code for node in policy.nodes}
    if not any(node.node_type == "inicio" for node in policy.nodes):
        observations.append("La politica no tiene nodo de inicio.")
    if not any(node.node_type == "fin" for node in policy.nodes):
        observations.append("La politica no tiene nodo de fin.")

    for node in policy.nodes:
        if node.node_type == "actividad" and not (node.responsible_role or node.responsible_department):
            observations.append(f"La actividad {node.code} no tiene responsable.")

    for transition in policy.transitions:
        if transition.source_code not in node_codes:
            observations.append(f"La transicion usa nodo origen inexistente: {transition.source_code}.")
        if transition.target_code not in node_codes:
            observations.append(f"La transicion usa nodo destino inexistente: {transition.target_code}.")

    return observations


def find_node(policy: Policy, node_code: str) -> PolicyNode | None:
    return next((node for node in policy.nodes if node.code == node_code), None)


def get_start_targets(policy: Policy) -> list[PolicyTransition]:
    start_node = next((node for node in policy.nodes if node.node_type == "inicio"), None)
    if not start_node:
        return []
    return [transition for transition in policy.transitions if transition.source_code == start_node.code]


def get_outgoing_transitions(policy: Policy, node_code: str) -> list[PolicyTransition]:
    return [transition for transition in policy.transitions if transition.source_code == node_code]


def resolve_next_nodes(policy: Policy, node_code: str, form_data: dict | None = None) -> list[PolicyNode]:
    transitions = get_outgoing_transitions(policy, node_code)
    if not transitions:
        return []

    if len(transitions) == 1:
        node = find_node(policy, transitions[0].target_code)
        return [node] if node else []

    resolved: list[PolicyNode] = []
    form_data = form_data or {}

    for transition in transitions:
        if transition.transition_type == "paralela":
            node = find_node(policy, transition.target_code)
            if node:
                resolved.append(node)
            continue

        if transition.condition_label:
            normalized_label = transition.condition_label.strip().lower()
            decision_value = str(form_data.get("decision", "")).strip().lower()
            if normalized_label == decision_value:
                node = find_node(policy, transition.target_code)
                if node:
                    return [node]

    fallback = find_node(policy, transitions[0].target_code)
    return [fallback] if fallback else []
