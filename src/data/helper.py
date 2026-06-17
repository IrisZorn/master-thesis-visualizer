import math


def distance(p1, p2):
    # If previous point is a None-marker (inserted to indicate a death),
    # treat distance as infinite so the next real point isn't accepted
    # unconditionally.
    if p1[0] is None:
        return float('inf')
    dx = p1[0] - p2[0]
    dy = p1[1] - p2[1]
    return math.sqrt(dx*dx + dy*dy)


def filter_points(points, ghost_points, hit_points, max_dist=200, big_dist=700, recovery_points=8):
    if len(points) < 2:
        return points

    filtered = [points[0]]
    i = 1

    while i < len(points):
        prev = filtered[-1]
        curr = points[i]

        d = distance(prev, curr)

        break_exists = any(prev[2] < p[2] < curr[2] for p in ghost_points) or any(prev[2] < p[2] < curr[2] for p in hit_points)

        if break_exists:
            filtered.append((None, None, curr[2] - 1))

        # normal movement
        if d <= max_dist:
            filtered.append(curr)
            i += 1
            continue

        # medium jump followed by normal movement
        if d <= big_dist and i + 1 < len(points):
            next_point = points[i + 1]

            if distance(curr, next_point) <= max_dist:
                filtered.append(curr)
                i += 1
                continue

        # possible glitch -> try recovery
        stable = True

        if i + recovery_points - 1 < len(points):
            for j in range(i, i + recovery_points - 1):
                if distance(points[j], points[j + 1]) > max_dist:
                    stable = False
                    #filtered.append((None, None, points[j][2] - 1))
                    break

            if stable:
                # We found a new stable segment.
                # Start accepting points again from here.
                filtered.extend(points[i:i + recovery_points])
                i += recovery_points

                while (
                    i < len(points)
                    and distance(filtered[-1], points[i]) <= max_dist
                ):
                    filtered.append(points[i])
                    i += 1

                continue

        # skip glitch point
        i += 1

    return filtered

def extract_singular_points(vals, time_thresh=200, dist_thresh=700, min_cluster_size=1):
    """
    Deduplicate detections.

    - vals: iterable of (x, y, t) tuples or lists
    - time_thresh: maximum time difference to consider two detections the same event
    - dist_thresh: maximum spatial distance (pixels) to consider two detections the same event

    Keeps the first detection in each cluster (ordered by time) and drops subsequent detections
    that are within both the time and distance thresholds. Clusters smaller than
    min_cluster_size are discarded entirely.
    """
    if not vals:
        return []

    clusters = []

    for v in vals:
        assigned_cluster = None

        for cluster in clusters:
            a = cluster[0]
            # time proximity
            if abs(a[2] - v[2]) <= time_thresh:
                # spatial proximity
                if distance(a, v) <= dist_thresh:
                    assigned_cluster = cluster
                    break

        if assigned_cluster is None:
            clusters.append([v])
        else:
            assigned_cluster.append(v)

    deduped = []
    for cluster in clusters:
        if len(cluster) >= min_cluster_size:
            deduped.append(cluster[0])

    return deduped


def detect_reconnecting_jump(
    points,
    jump_dist=180,
    return_dist=120,
    max_branch_points=40,
    min_branch_points=2,
    min_deviation=80,
):
    """
    Detect a path segment that suddenly jumps away from its current course and
    reconnects soon after near the point it departed from.

    Returns a dictionary describing the first detected branch, or None if no
    such pattern is found.
    """
    valid_points = [point for point in points if point[0] is not None]
    if len(valid_points) < 4:
        return None

    for anchor_index in range(len(valid_points) - (min_branch_points + 1)):
        anchor = valid_points[anchor_index]
        departure = valid_points[anchor_index + 1]

        if distance(anchor, departure) < jump_dist:
            continue

        search_end = min(len(valid_points), anchor_index + max_branch_points + 2)

        for reconnect_index in range(anchor_index + min_branch_points + 2, search_end):
            reconnect = valid_points[reconnect_index]

            if distance(anchor, reconnect) > return_dist:
                continue

            branch = valid_points[anchor_index + 1:reconnect_index]
            if len(branch) < min_branch_points:
                continue

            max_deviation = max(distance(anchor, point) for point in branch)
            if max_deviation < min_deviation:
                continue

            return {
                "anchor_index": anchor_index,
                "departure_index": anchor_index + 1,
                "reconnect_index": reconnect_index,
                "anchor": anchor,
                "departure": departure,
                "reconnect": reconnect,
                "branch_points": branch,
                "max_deviation": max_deviation,
            }

    return None


def remove_reconnecting_jumps(points, **kwargs):
    cleaned = list(points)

    while True:
        detection = detect_reconnecting_jump(cleaned, **kwargs)
        if detection is None:
            return cleaned

        anchor = detection["anchor"]
        reconnect = detection["reconnect"]
        skipping = False
        reduced = []

        for point in cleaned:
            if point[0] is None:
                reduced.append(point)
                continue

            if not skipping and point == anchor:
                reduced.append(point)
                skipping = True
                continue

            if skipping:
                if point == reconnect:
                    reduced.append(point)
                    skipping = False
                continue

            reduced.append(point)

        if len(reduced) == len(cleaned):
            return cleaned

        cleaned = reduced
