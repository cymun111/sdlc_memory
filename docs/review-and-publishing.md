# Review and publishing

The intended lifecycle is candidate intake, owner review, and publication through a protected knowledge-repository branch. New submissions must not publish themselves or alter existing policy. Rejection should retain a reason; disputes and supersession must preserve history.

This starter only supports writing a new local candidate file via `knowledge submit --file <path> --repo <id>`. It does not provide a candidate queue, deduplication, expected-hash approval, rejection, conflict resolution, pull-request creation, or publishing automation. Do not enable branch protection based on the presence of CI templates alone; configure and verify it in the hosting provider.
