import Foundation

public protocol ScoutChangeSetting: AnyObject {}

public extension ScoutChangeSetting {
    func scoutSetIfChanged<T: Equatable>(_ value: T, to keyPath: ReferenceWritableKeyPath<Self, T>) {
        if self[keyPath: keyPath] != value {
            self[keyPath: keyPath] = value
        }
    }
}
