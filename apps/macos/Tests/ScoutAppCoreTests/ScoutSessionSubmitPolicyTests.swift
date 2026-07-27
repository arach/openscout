import ScoutAppCore
import Testing

struct ScoutSessionSubmitPolicyTests {
    @Test
    func plainReturnSubmits() {
        #expect(
            ScoutSessionSubmitPolicy.shouldSubmit(
                isReturn: true,
                shift: false,
                option: false
            )
        )
    }

    @Test(arguments: [(true, false), (false, true), (true, true)])
    func modifiedReturnKeepsLineBreaks(shift: Bool, option: Bool) {
        #expect(
            !ScoutSessionSubmitPolicy.shouldSubmit(
                isReturn: true,
                shift: shift,
                option: option
            )
        )
    }

    @Test
    func nonReturnKeysDoNotSubmit() {
        #expect(
            !ScoutSessionSubmitPolicy.shouldSubmit(
                isReturn: false,
                shift: false,
                option: false
            )
        )
    }
}
