# Election Tallying

This context describes the language used to record and tally the two independent committee elections held by the Shanghai Gas trade union.

## Language

**Election**:
One independently tallied committee election. A ballot record and its validity belong to exactly one election and never affect the other election.
_Avoid_: Election section, combined election

**Union Committee Election**:
The election of 23 members from the 26 listed candidates for the trade union committee.
_Avoid_: First election

**Expense Review Committee Election**:
The election of 7 members from the 8 listed candidates for the expense review committee.
_Avoid_: Expense committee election, second election

**Elector Limit**:
The maximum number of non-withdrawn ballot records that may be accepted for an election, fixed at 180 for this event. Withdrawing a record frees one place without reusing its sequence number.
_Avoid_: Expected ballot count, required turnout

**Listed Candidate**:
A person whose name is preprinted on the official ballot for an election.
_Avoid_: Default candidate, in-range candidate

**Write-in Candidate**:
A person not preprinted on the ballot whose name is supplied by the voter. Each write-in candidate represents one approval and requires one listed-candidate opposition on the same ballot; names are trimmed of surrounding whitespace and otherwise compared exactly, and one ballot cannot repeat a write-in name or use a listed candidate's name as a write-in.
_Avoid_: Out-of-range candidate, replacement candidate

**Recording Group**:
A tallying team assigned a distinct set of physical ballots. The Union Committee Election has three concurrent recording groups, while the Expense Review Committee Election has one; every physical ballot belongs to exactly one group, and any recording device may select the applicable group.
_Avoid_: User, duplicate-entry group

**Ballot Record**:
A recording group's digital representation of one physical ballot for one election. Records receive a global sequential number within that election, and a withdrawn record's number is never reused during the current tally.
_Avoid_: Vote, result row

**Withdrawn Ballot Record**:
A previously submitted ballot record that its recording group has removed from the tally because it was entered incorrectly. It remains in the shared recording history, contributes no totals, and is replaced by a newly numbered ballot record when re-entered.
_Avoid_: Deleted ballot, edited ballot

**Approval**:
A vote in favor of a listed candidate, or the vote inherently assigned to a write-in candidate.
_Avoid_: Selection, check

**Opposition**:
A vote against a listed candidate. Each opposition permits at most one write-in candidate on the same ballot.
_Avoid_: Rejection, negative vote

**Abstention**:
No vote for or against a listed candidate. An abstention cannot be used to permit a write-in candidate.
_Avoid_: Blank vote, no selection

**Valid Ballot**:
A ballot that is not manually marked invalid and whose approvals, including all write-in candidates, do not exceed the election's seat count.
_Avoid_: Normal ballot

**Invalid Ballot**:
Either an overvote or a manually invalid ballot. Both kinds contribute to the same invalid-ballot total and no candidate totals.
_Avoid_: Invalidity category, rejected ballot

**Overvote**:
A ballot whose approvals, including all write-in candidates, exceed the election's seat count. It contributes only to the election's invalid-ballot count and contributes no candidate totals.
_Avoid_: Excess ballot, malformed ballot

**Manual Invalid Ballot**:
A ballot explicitly marked invalid by a recording group regardless of its candidate selections. It records no invalidity reason and contributes no candidate totals.
_Avoid_: Rejected ballot, invalid ballot with reason

**Candidate Ranking**:
The single ranking of listed and write-in candidates, ordered first by approvals descending and then by oppositions ascending. Write-in candidates have zero oppositions; candidates equal on both values share a competition rank, such as 1, 2, 2, 4, and are displayed in name-pinyin order.
_Avoid_: Winner declaration, listed-candidate ranking

**Tally Result**:
The continuously available aggregate for one election. It contains the active ballot total, valid-ballot total, invalid-ballot total, and every candidate's competition rank, approvals, and oppositions, without group-level or invalidity-category breakdowns.
_Avoid_: Final result, group result

**Tally Reset**:
The permanent removal of all ballot records and sequence numbers for one election or both elections so counting can restart from zero. A reset has no restore or backup operation.
_Avoid_: Start tally, end tally, archive tally

**Administrator**:
The password-protected role whose only additional capability is permanently resetting either election or both elections after confirmation.
_Avoid_: Supervisor, tally closer
