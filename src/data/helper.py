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


def path_efficiency(points, start, end):
    # ratio of net displacement to total distance travelled: close to 1 for a trajectory that
    # commits to a direction (even slowly), close to 0 for jitter that wanders in place. Using
    # net displacement alone can't tell those apart, since slow-but-real movement and bounded
    # noise can cover a similar net distance over a fixed window.
    net = distance(points[start], points[end])
    total = sum(distance(points[i], points[i + 1]) for i in range(start, end))
    return net / total if total > 0 else 0


def find_stable_start(points, max_dist, recovery_points, progress_window=30, min_efficiency=0.12):
    # points[0] would otherwise be trusted unconditionally with nothing earlier to validate
    # it against. When the detector hasn't locked on yet at the start of a recording, that
    # seeds the trail with a bogus point later connected to the real path by one giant jump.
    # A single bad point is caught by requiring a run of recovery_points points that move
    # normally frame-to-frame (the same stability check used for mid-stream glitch recovery
    # below) -- but a whole noisy cluster (e.g. an intro/idle pose) can itself be locally
    # stable for much longer than that while going nowhere, so also require that the
    # candidate actually goes somewhere over a longer lookahead before accepting it.
    max_start = len(points) - recovery_points
    fallback = None

    for start in range(max_start + 1):
        if not all(distance(points[j], points[j + 1]) <= max_dist for j in range(start, start + recovery_points - 1)):
            continue
        if fallback is None:
            fallback = start

        end = min(start + progress_window, len(points)) - 1
        if end <= start:
            return start
        if path_efficiency(points, start, end) >= min_efficiency:
            return start

    return fallback if fallback is not None else 0


def filter_points(points, ghost_points, hit_points, max_dist=200, big_dist=700, recovery_points=8, max_gap=80):
    if len(points) < 2:
        return points

    start = find_stable_start(points, max_dist, recovery_points)
    filtered = [points[start]]
    i = start + 1

    while i < len(points):
        prev = filtered[-1]
        curr = points[i]

        d = distance(prev, curr)
        gap = curr[2] - prev[2]

        break_exists = any(prev[2] < p[2] < curr[2] for p in ghost_points) or any(prev[2] < p[2] < curr[2] for p in hit_points)

        if break_exists:
            filtered.append((None, None, curr[2] - 1))

        # normal movement -- gated on gap, not just distance, so a detection that lands close to
        # an old position purely by chance after a long silence (e.g. a misdetection while the
        # real subject is dead/off-screen) still has to earn its way back in via the stricter
        # recovery check below, rather than being trusted just for being nearby.
        if d <= max_dist and gap <= max_gap:
            filtered.append(curr)
            i += 1
            continue

        # medium jump followed by normal movement
        if d <= big_dist and gap <= max_gap and i + 1 < len(points):
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


def remove_single_point_spikes(points, min_jump=50, max_reconnect=60, max_spike_points=5):
    """
    Drop short runs of up to max_spike_points points that jump far from the path and land
    back close to where they left off a few frames later -- the short-branch case
    remove_reconnecting_jumps can't catch, since that function requires a multi-point branch
    (min_branch_points) to avoid mistaking brief-but-real movement for noise. A spike this
    short has no such ambiguity for these enemies: they don't move fast enough for a round
    trip of min_jump+ within a couple of frames to be real, so it's always the detector
    glitching onto something else briefly. Shorter spikes are preferred over longer ones when
    both would qualify, since that removes the fewest points needed to explain the jump.
    """
    if len(points) < 3:
        return list(points)

    valid_indices = [index for index, point in enumerate(points) if point[0] is not None]
    keep = [True] * len(points)
    anchor_pos = 0

    while anchor_pos < len(valid_indices) - 2:
        anchor_point = points[valid_indices[anchor_pos]]
        removed_spike_len = 0

        for spike_len in range(1, max_spike_points + 1):
            reconnect_pos = anchor_pos + spike_len + 1
            if reconnect_pos >= len(valid_indices):
                break

            spike_positions = range(anchor_pos + 1, reconnect_pos)
            spike_points = [points[valid_indices[p]] for p in spike_positions]
            reconnect_point = points[valid_indices[reconnect_pos]]

            if distance(anchor_point, spike_points[0]) < min_jump:
                continue
            if distance(spike_points[-1], reconnect_point) < min_jump:
                continue
            if distance(anchor_point, reconnect_point) > max_reconnect:
                continue

            for p in spike_positions:
                keep[valid_indices[p]] = False
            removed_spike_len = spike_len
            break

        anchor_pos += removed_spike_len + 1 if removed_spike_len else 1

    return [point for index, point in enumerate(points) if keep[index]]


def cluster_points_by_distance(points, distance_threshold=120):
    valid_points = [point for point in points if point and point[0] is not None and point[1] is not None]
    clusters = []

    for point in valid_points:
        assigned = None
        for cluster in clusters:
            anchor = cluster[0]
            if distance(anchor, point) <= distance_threshold:
                assigned = cluster
                break

        if assigned is None:
            clusters.append([point])
        else:
            assigned.append(point)

    return clusters


def remove_reconnecting_jumps(
    points,
    jump_dist=150,
    max_branch_points=70,
    min_branch_points=3,
    min_deviation=70,
):
    """
    Remove path segments that suddenly jump away from the current course and
    reconnect soon after near the point they departed from, collapsing each
    detected branch down to just its anchor and reconnect point. None-marker
    points (death markers) are always kept.
    """
    valid_indices = [index for index, point in enumerate(points) if point[0] is not None]
    if len(valid_indices) < 4:
        return list(points)

    keep = [True] * len(points)
    anchor_pos = 0

    while anchor_pos < len(valid_indices) - (min_branch_points + 1):
        anchor = points[valid_indices[anchor_pos]]
        departure = points[valid_indices[anchor_pos + 1]]

        if distance(anchor, departure) < jump_dist:
            anchor_pos += 1
            continue

        search_end = min(len(valid_indices), anchor_pos + max_branch_points + 2)
        reconnect_pos = None

        for candidate_pos in range(anchor_pos + min_branch_points + 2, search_end):
            candidate = points[valid_indices[candidate_pos]]

            if distance(anchor, candidate) > jump_dist:
                continue

            branch_positions = range(anchor_pos + 1, candidate_pos)
            branch_points = [points[valid_indices[p]] for p in branch_positions]
            if len(branch_points) < min_branch_points:
                continue

            max_deviation = max(distance(anchor, point) for point in branch_points)
            if max_deviation < min_deviation:
                continue

            reconnect_pos = candidate_pos
            for p in branch_positions:
                keep[valid_indices[p]] = False
            break

        anchor_pos = reconnect_pos if reconnect_pos is not None else anchor_pos + 1

    return [point for index, point in enumerate(points) if keep[index]]
