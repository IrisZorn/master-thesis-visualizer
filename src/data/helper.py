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


def filter_points(points, ghost_points, hit_points, max_dist=200, big_dist=700, recovery_points=5):
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

def extract_singular_points(vals, time_thresh=200, dist_thresh=700):
    """
    Deduplicate detections.

    - vals: iterable of (x, y, t) tuples or lists
    - time_thresh: maximum time difference to consider two detections the same event
    - dist_thresh: maximum spatial distance (pixels) to consider two detections the same event

    Keeps the first detection in each cluster (ordered by time) and drops subsequent detections
    that are within both the time and distance thresholds.
    """
    if not vals:
        return []

    deduped = []

    for v in vals:

        x, y, t = v
        is_duplicate = False

        for a in deduped:
            # time proximity
            if abs(a[2] - t) <= time_thresh:
                # spatial proximity
                if distance(a, v) <= dist_thresh:
                    is_duplicate = True
                    break

        if not is_duplicate:
            deduped.append(v)

    return deduped
