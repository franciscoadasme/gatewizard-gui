import logging
import unittest

from access_log import (
    PollAccessFilter,
    attach_poll_access_filter,
    should_log_access,
)


class AccessLogTests(unittest.TestCase):
    def test_poll_2xx_is_quiet(self):
        self.assertFalse(should_log_access("/project-status", 200))
        self.assertFalse(should_log_access("/scan-tools-jobs", 200))
        self.assertFalse(should_log_access("/scan-jobs", 204))
        self.assertFalse(should_log_access("/job-status", 200))
        self.assertFalse(should_log_access("/scan-analysis-sessions", 200))
        self.assertFalse(should_log_access("/project-status?directory=/tmp", 200))

    def test_errors_and_real_work_still_log(self):
        self.assertTrue(should_log_access("/project-status", 500))
        self.assertTrue(should_log_access("/scan-tools-jobs", 400))
        self.assertTrue(should_log_access("/get-structure", 200))
        self.assertTrue(should_log_access("/trajectory/xyz", 200))

    def test_filter_reads_uvicorn_args(self):
        filt = PollAccessFilter()
        quiet = logging.LogRecord(
            "uvicorn.access",
            logging.INFO,
            __file__,
            1,
            '%s - "%s %s HTTP/%s" %d',
            ("127.0.0.1:1", "GET", "/project-status", "1.1", 200),
            None,
        )
        loud = logging.LogRecord(
            "uvicorn.access",
            logging.INFO,
            __file__,
            1,
            '%s - "%s %s HTTP/%s" %d',
            ("127.0.0.1:1", "POST", "/get-structure", "1.1", 200),
            None,
        )
        self.assertFalse(filt.filter(quiet))
        self.assertTrue(filt.filter(loud))

    def test_attach_is_idempotent(self):
        logger = logging.getLogger("uvicorn.access")
        before = len(logger.filters)
        attach_poll_access_filter()
        attach_poll_access_filter()
        added = [f for f in logger.filters if isinstance(f, PollAccessFilter)]
        self.assertEqual(len(added), 1)
        logger.filters[:] = [f for f in logger.filters if not isinstance(f, PollAccessFilter)]
        self.assertEqual(len(logger.filters), before)


if __name__ == "__main__":
    unittest.main()
