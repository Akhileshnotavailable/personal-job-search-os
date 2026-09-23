"""The subject line is the whole notification for most glances at a phone."""

from crawler.notify import SUBJECT_BUDGET, _subject


def test_leads_with_company_names():
    s = _subject(3, ["Adobe", "NVIDIA", "Sarvam AI"])
    assert s == "[APPLY] - Adobe, NVIDIA, Sarvam AI · 3 new design roles"


def test_always_carries_the_apply_prefix():
    assert _subject(1, ["Adobe"]).startswith("[APPLY] - ")


def test_singular_when_one_role():
    assert _subject(1, ["Adobe"]).endswith("1 new design role")


def test_truncates_long_company_lists_but_keeps_the_first():
    names = ["Databricks", "ServiceNow", "Salesforce", "Uber Freight", "Zeta Suite", "Postman"]
    s = _subject(20, names)
    assert s.startswith("[APPLY] - Databricks")
    assert "more" in s
    assert len(s) <= SUBJECT_BUDGET


def test_stays_within_budget_even_for_one_very_long_name():
    s = _subject(2, ["A Company With An Extremely Long Legal Name Incorporated Limited"])
    # A single name is never dropped -- an empty company list would defeat the point.
    assert "A Company With" in s


def test_reports_the_true_count_not_the_number_shown():
    names = [f"Company{i}" for i in range(12)]
    s = _subject(40, names)
    assert "40 new design roles" in s
