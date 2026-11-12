<?php

namespace App\Filament\Pages;

use Filament\Actions\Action;
use Filament\Actions\ActionGroup;
use Filament\Forms\Components\Checkbox;
use Filament\Forms\Components\DatePicker;
use Filament\Forms\Components\FileUpload;
use Filament\Forms\Components\Hidden;
use Filament\Forms\Components\Select;
use Filament\Forms\Components\TextInput;
use Filament\Tables\Columns\TextColumn;
use Filament\Tables\Enums\FiltersLayout;
use Filament\Tables\Filters\SelectFilter;
use Filament\Tables\Table;
use Illuminate\Support\Collection;

class Inventory extends RecordsPage
{
    protected static ?string $title = 'Inventory & shop';

    protected static ?string $navigationLabel = 'Cards & stock';

    protected static ?int $navigationSort = 10;

    protected string $view = 'filament.pages.inventory';

    public function table(Table $table): Table
    {
        return parent::table($table)
            ->filters([
                SelectFilter::make('club')->label('Team')->placeholder('All teams')
                    ->options(fn (): array => $this->filterOptions('club'))->searchable(),
                SelectFilter::make('variant')->label('Card type')->placeholder('All card types')
                    ->options(fn (): array => $this->filterOptions('variant'))->searchable(),
            ], layout: FiltersLayout::AboveContent)
            ->filtersFormColumns(2)
            ->deferFilters(false);
    }

    protected function filterOptions(string $column): array
    {
        return collect($this->client()->get('/api/inventory')['cards'])
            ->pluck($column)->filter()->unique()->sort()
            ->mapWithKeys(fn (string $value): array => [$value => $value])->all();
    }

    protected function filterRows(Collection $rows, array $filters): Collection
    {
        foreach (['club', 'variant'] as $column) {
            $value = $filters[$column]['value'] ?? null;
            if (filled($value)) {
                $rows = $rows->whereStrict($column, $value);
            }
        }

        return $rows;
    }

    protected function sourceRows(): array
    {
        $shop = $this->client()->get('/api/admin/shop');
        $products = collect($shop['products'])->keyBy('id');
        $targets = collect($shop['stockSync']['targets'])->keyBy('card_id');
        $listings = collect($shop['listings'])->keyBy('card_id');
        $jobs = collect($shop['stockSync']['jobs'] ?? [])->keyBy('card_id');

        return collect($this->client()->get('/api/inventory')['cards'])
            ->map(function (array $card) use ($shop, $products, $targets, $listings, $jobs): array {
                $product = $products[$card['id']] ?? [];
                $allocated = $listings[$card['id']]['quantity'] ?? 0;
                $requested = $targets[$card['id']]['quantity'] ?? $allocated;
                $available = $product['available'] ?? 0;
                $price = $product['price'] ?? null;
                $issue = $requested > 0 ? ($jobs[$card['id']]['error'] ?? '') : '';
                $status = match (true) {
                    $available > 0 => 'Available',
                    ! $price || $requested === 0 => 'Not listed',
                    $card['stock'] === 0 => 'Out of stock',
                    (bool) ($shop['stockSync']['paused'] ?? false) => 'Paused',
                    filled($issue) => 'Needs review',
                    $requested > $allocated => 'Checking stock',
                    default => 'Unavailable',
                };

                return [...$card, 'price' => $price, 'photo' => $product['photo'] ?? '',
                    'requested' => $requested, 'allocated' => $allocated, 'available' => $available,
                    'website_status' => $status, 'website_issue' => $issue];
            })->all();
    }

    protected function columns(): array
    {
        return [
            TextColumn::make('number')->label('#')->sortable(),
            TextColumn::make('player')->sortable()->wrap()
                ->description(fn (array $record): string => $record['variant'].' · '.$record['condition']),
            TextColumn::make('club')->sortable()->toggleable(isToggledHiddenByDefault: true),
            TextColumn::make('variant')->toggleable(isToggledHiddenByDefault: true),
            TextColumn::make('condition')->toggleable(isToggledHiddenByDefault: true),
            TextColumn::make('stock')->label('Owned')->numeric()->sortable(),
            TextColumn::make('price')->label('Shop price')->money('GBP', divideBy: 100)->placeholder('Set price'),
            TextColumn::make('available')->label('Shop available')->numeric()->sortable(),
            TextColumn::make('website_status')->label('Shop status')->badge()
                ->color(fn (string $state): string => match ($state) {
                    'Available' => 'success',
                    'Needs review', 'Paused' => 'danger',
                    'Checking stock', 'Unavailable' => 'warning',
                    default => 'gray',
                })
                ->description(fn (array $record): ?string => $record['website_issue'] ?: null)->wrap(),
            TextColumn::make('requested')->label('Requested for shop')->numeric()->toggleable(isToggledHiddenByDefault: true),
            TextColumn::make('allocated')->label('Reserved for shop')->numeric()->toggleable(isToggledHiddenByDefault: true),
            TextColumn::make('stock_cost')->label('Stock cost')->money('GBP', divideBy: 100)->toggleable(isToggledHiddenByDefault: true),
        ];
    }

    protected function rowActions(): array
    {
        return [
            $this->shopAction(),
            ActionGroup::make($this->stockActions())->label('Stock')->button()->color('gray'),
        ];
    }

    protected function shopAction(): Action
    {
        return $this->adminAction('listing')->label('Edit shop')
            ->modalHeading(fn (array $record): string => $record['player'].' #'.$record['number'].' · Shop details')
            ->modalDescription(fn (array $record): string => 'You own '.$record['stock'].' copies. Set their selling details here; use Stock to receive or count copies.')
            ->fillForm(fn (array $record): array => [
                'price' => $record['price'] === null ? null : $record['price'] / 100,
                'quantity' => $record['requested'],
                'condition' => $record['condition'],
                'photo_url' => str_starts_with($record['photo'], 'https://') ? $record['photo'] : '',
                'image' => str_starts_with($record['photo'], '/storage/') ? substr($record['photo'], 9) : null,
                'stockConfirmed' => false,
            ])
            ->schema([
                $this->moneyInput('price', 'Selling price per card')->minValue(0.50),
                TextInput::make('quantity')->label('Copies to sell on the website')->integer()->minValue(0)
                    ->maxValue(fn (array $record): int => $record['stock'])->required()
                    ->helperText('Choose copies from your owned stock. Set 0 to stop offering this card. eBay stock checks run before copies become available to buy.'),
                Select::make('condition')->options(array_combine(
                    ['Not assessed', 'Near mint', 'Excellent', 'Very good', 'Good', 'Poor'],
                    ['Not assessed', 'Near mint', 'Excellent', 'Very good', 'Good', 'Poor'],
                ))->required(),
                FileUpload::make('image')->label('Card photo')->image()
                    ->acceptedFileTypes(['image/jpeg', 'image/png', 'image/webp'])->maxSize(5120)
                    ->disk('public')->directory('cards')->visibility('public'),
                TextInput::make('photo_url')->label('Or use a hosted HTTPS photo')->url()->maxLength(2000),
                Checkbox::make('stockConfirmed')->label('I have counted these physical copies and assessed their condition.'),
            ])
            ->action(function (array $data, array $record): void {
                $photo = filled($data['image'] ?? null) ? '/storage/'.$data['image'] : ($data['photo_url'] ?? '');
                $this->perform('/api/admin/shop', [
                    'cardId' => $record['id'], 'price' => $this->pence($data['price']),
                    'quantity' => $data['quantity'], 'condition' => $data['condition'],
                    'photo' => $photo, 'stockConfirmed' => $data['stockConfirmed'],
                ], 'Shop details saved; Shop available shows the verified quantity');
            });
    }

    protected function getHeaderActions(): array
    {
        return [$this->adminAction('addCard')->label('Add card')->schema([
            TextInput::make('player')->required()->maxLength(150), TextInput::make('club')->required()->maxLength(150), TextInput::make('number')->required()->maxLength(150),
            TextInput::make('season')->default('2026/27')->required(), TextInput::make('collection')->default('Topps Flagship Premier League')->required(), TextInput::make('variant')->default('Base')->required(),
            Select::make('condition')->options(array_combine(['Near mint', 'Excellent', 'Very good', 'Good', 'Poor'], ['Near mint', 'Excellent', 'Very good', 'Good', 'Poor']))->required(),
            TextInput::make('quantity')->label('Copies received')->integer()->minValue(1)->required(), $this->moneyInput('unitCost', 'Cost per card'), DatePicker::make('date')->default(today())->required(),
        ])->action(fn (array $data) => $this->perform('/api/inventory', [...$data, 'action' => 'card', 'unitCost' => $this->pence($data['unitCost'])], 'Card added')),
            $this->adminAction('export')->label('Export inventory')->url(route('admin.export', ['kind' => 'inventory']))];
    }

    protected function stockActions(): array
    {
        return [
            $this->adminAction('receive')->label('Receive stock')->schema([TextInput::make('quantity')->integer()->minValue(1)->required(), $this->moneyInput('unitCost', 'Cost per card'), DatePicker::make('date')->default(today())->required()])
                ->action(fn (array $data, array $record) => $this->perform('/api/inventory', [...$data, 'action' => 'stock', 'cardId' => $record['id'], 'unitCost' => $this->pence($data['unitCost'])], 'Receipt recorded')),
            $this->adminAction('count')->label('Set counted stock')->fillForm(fn (array $record): array => ['quantity' => $record['stock'], 'expectedStock' => $record['stock'], 'unitCost' => 0, 'date' => today()->toDateString()])
                ->schema([TextInput::make('quantity')->label('Physical copies counted')->integer()->minValue(0)->required(), Hidden::make('expectedStock'), $this->moneyInput('unitCost', 'Cost per additional card'), DatePicker::make('date')->required()])
                ->action(fn (array $data, array $record) => $this->perform('/api/inventory', [...$data, 'action' => 'adjust', 'cardId' => $record['id'], 'unitCost' => $this->pence($data['unitCost'])], 'Count updated')),
            $this->adminAction('sale')->label('Record offline sale')->schema([TextInput::make('quantity')->integer()->minValue(1)->required(), $this->moneyInput('unitPrice', 'Sale price per card'), $this->moneyInput('fees', 'Total fees and postage cost'), Select::make('platform')->options(['In person' => 'In person', 'Other' => 'Other'])->required(), DatePicker::make('date')->default(today())->required()])
                ->action(fn (array $data, array $record) => $this->perform('/api/inventory', [...$data, 'action' => 'sale', 'cardId' => $record['id'], 'unitPrice' => $this->pence($data['unitPrice']), 'fees' => $this->pence($data['fees'])], 'Sale recorded')),
        ];
    }
}
