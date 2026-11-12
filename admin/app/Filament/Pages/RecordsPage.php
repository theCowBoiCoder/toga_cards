<?php

namespace App\Filament\Pages;

use App\Services\InventoryClient;
use Filament\Actions\Action;
use Filament\Forms\Components\TextInput;
use Filament\Notifications\Notification;
use Filament\Pages\Page;
use Filament\Support\Exceptions\Halt;
use Filament\Tables\Concerns\InteractsWithTable;
use Filament\Tables\Contracts\HasTable;
use Filament\Tables\Table;
use Illuminate\Pagination\LengthAwarePaginator;
use Illuminate\Support\Collection;
use Illuminate\Validation\ValidationException;

abstract class RecordsPage extends Page implements HasTable
{
    use InteractsWithTable;

    protected string $view = 'filament.pages.records';

    protected static ?int $navigationSort = 10;

    public static function canAccess(): bool
    {
        return auth()->user()?->is_admin === true;
    }

    protected function client(): InventoryClient
    {
        return app(InventoryClient::class);
    }

    abstract protected function sourceRows(): array;

    abstract protected function columns(): array;

    protected function rowActions(): array
    {
        return [];
    }

    protected function filterRows(Collection $rows, array $filters): Collection
    {
        return $rows;
    }

    public function table(Table $table): Table
    {
        return $table->records(function (?string $search, ?string $sortColumn, ?string $sortDirection, int $page, int $recordsPerPage, ?array $filters): LengthAwarePaginator {
            $this->client()->authorize();
            $rows = collect($this->sourceRows())->keyBy('id');
            $rows = $this->filterRows($rows, $filters ?? []);
            if (filled($search)) {
                $rows = $rows->filter(fn (array $row): bool => str_contains(mb_strtolower(implode(' ', array_filter($row, fn ($value): bool => is_scalar($value)))), mb_strtolower($search)));
            }
            if ($sortColumn) {
                $rows = $rows->sortBy($sortColumn, SORT_REGULAR, $sortDirection === 'desc');
            }

            return new LengthAwarePaginator($rows->forPage($page, $recordsPerPage), $rows->count(), $recordsPerPage, $page);
        })->columns($this->columns())->recordActions($this->rowActions())->searchable()->paginated([25, 50, 100])->defaultPaginationPageOption(25)->emptyStateHeading('No matching records');
    }

    protected function perform(string $path, array $data, string $title = 'Saved'): void
    {
        try {
            $this->client()->mutate($path, $data);
            Notification::make()->title($title)->success()->send();
            $this->flushCachedTableRecords();
        } catch (ValidationException $exception) {
            Notification::make()->title('Change not confirmed')->body(implode(' ', $exception->validator->errors()->all()))->danger()->persistent()->send();
            throw new Halt;
        }
    }

    protected function adminAction(string $name): Action
    {
        return Action::make($name)->authorize(fn (): bool => static::canAccess());
    }

    protected function moneyInput(string $name, string $label): TextInput
    {
        return TextInput::make($name)->label($label)->prefix('£')->numeric()->minValue(0)->maxValue(1000000)->step(0.01)->required()->default(0);
    }

    protected function pence(mixed $value): int
    {
        return (int) round(((float) $value) * 100);
    }

    protected function cardOptions(string $search): array
    {
        return collect($this->client()->get('/api/inventory')['cards'])->filter(fn (array $card): bool => str_contains(mb_strtolower($card['player'].' '.$card['number'].' '.$card['variant']), mb_strtolower($search)))->take(40)->mapWithKeys(fn (array $card): array => [$card['id'] => '#'.$card['number'].' '.$card['player'].' · '.$card['variant'].' · '.$card['condition']])->all();
    }
}
